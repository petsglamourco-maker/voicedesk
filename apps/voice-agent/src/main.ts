import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cli,
  defineAgent,
  inference,
  ServerOptions,
  voice,
  type JobContext,
} from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import {
  AudioStream,
  RoomEvent,
  TrackKind,
  type RemoteParticipant,
  type RemoteTrack,
} from "@livekit/rtc-node";
import type { EmbeddingProvider, LlmProvider, ObjectStorage } from "@voicedesk/adapters";
import { embeddingsFromEnv, storageFromEnv } from "@voicedesk/adapters/from-env";
import {
  createConversation,
  endConversation,
  loadAgentContext,
  loadConversationState,
  normalisePhone,
  silentGoodbyePhrase,
  stillTherePhrase,
  sttLanguageFor,
  voiceFor,
  type ConversationState,
} from "@voicedesk/agent-brain";
import { createLogger } from "@voicedesk/compliance/logger";
import { loadRootEnv } from "@voicedesk/config/load-env";
import {
  createAppLlm,
  googleCalendarFactory,
  googleOAuthFromEnv,
  SecretBox,
  type CalendarFactory,
} from "@voicedesk/core";
import { createDb, type Database } from "@voicedesk/db";
import { createAiQueue, createRedisConnection } from "@voicedesk/jobs";
import { EngineLlmPlaceholder, EngineVoiceAgent } from "./agent";
import { EngineBridge, median, type TurnTimings } from "./bridge";
import {
  activePhoneNumber,
  callerFromSip,
  loadGreeting,
  parseJobMetadata,
  saveRecording,
  saveVoiceMetrics,
  type JobIds,
} from "./job";
import { CallRecorder, RECORDING_SAMPLE_RATE } from "./recorder";
import { SILENCE_SECONDS, SilenceHandler } from "./silence";
import { TeeAudioOutput } from "./tee-output";

/** Must match VOICE_AGENT_NAME in apps/api (explicit dispatch only). */
const AGENT_NAME = "voicedesk-agent";
/** Data-channel topic the browser test console reads latency from. */
const METRICS_TOPIC = "voicedesk.latency";

const envFile = loadRootEnv();
const repoRoot = envFile ? dirname(envFile) : process.cwd();
const log = createLogger("voice-agent", process.env.LOG_LEVEL ?? "info");

// Shared per job process: database pool, AI-provider router, embeddings model.
let shared:
  | {
      db: Database;
      llm: LlmProvider;
      embeddings: Promise<EmbeddingProvider>;
      storage: () => ObjectStorage;
      calendars: { box: SecretBox | null; factory: CalendarFactory | null };
    }
  | undefined;
function resources() {
  if (!shared) {
    const db = createDb(process.env.DATABASE_URL!);
    const box = SecretBox.fromEnv();
    const oauth = googleOAuthFromEnv();
    shared = {
      db,
      calendars: { box, factory: oauth ? googleCalendarFactory(oauth) : null },
      llm: createAppLlm(db, {
        box,
        anthropicEnvKey: process.env.ANTHROPIC_API_KEY || undefined,
      }),
      embeddings: embeddingsFromEnv(process.env, repoRoot),
      storage: (() => {
        let s3: ObjectStorage | undefined;
        return () => (s3 ??= storageFromEnv());
      })(),
    };
  }
  return shared;
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const job = parseJobMetadata(ctx.job.metadata);
    const { db, llm, embeddings, storage, calendars } = resources();
    const agentCtx = await loadAgentContext(db, job.tenantId, "voice");
    await ctx.connect();

    // Recording starts with the call (only when the business records calls).
    const recorder = agentCtx.recordCalls ? new CallRecorder() : null;
    const recordCaller = (track: RemoteTrack, participant: RemoteParticipant) => {
      if (!recorder || track.kind !== TrackKind.KIND_AUDIO) return;
      if (participant.identity === ctx.room.localParticipant?.identity) return;
      void (async () => {
        for await (const frame of new AudioStream(track, RECORDING_SAMPLE_RATE, 1)) {
          recorder.addCaller(frame);
        }
      })().catch(() => undefined);
    };
    ctx.room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) =>
      recordCaller(track, participant),
    );
    for (const participant of ctx.room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.track) recordCaller(pub.track, participant);
      }
    }

    let ids: JobIds;
    let state: ConversationState;
    let opening: string | null;
    if (job.kind === "browser") {
      ids = { tenantId: job.tenantId, conversationId: job.conversationId };
      const stored = await loadConversationState(db, ids.tenantId, ids.conversationId);
      if (!stored || stored.status !== "active") {
        log.warn({ conversationId: ids.conversationId }, "conversation not active; not joining");
        return;
      }
      state = stored.state;
      opening = await loadGreeting(db, ids);
    } else {
      const number = await activePhoneNumber(db, job.tenantId, job.phoneNumberId);
      if (!number) {
        log.warn({ phoneNumberId: job.phoneNumberId }, "call to an inactive number; hanging up");
        await ctx.deleteRoom();
        return;
      }
      const participant = await ctx.waitForParticipant();
      const caller = callerFromSip(participant.attributes);
      const created = await createConversation(db, agentCtx, {
        tenantId: job.tenantId,
        channel: "voice",
        callerPhone: caller.callerPhone
          ? (normalisePhone(caller.callerPhone, agentCtx.countryCode) ?? caller.callerPhone)
          : null,
        phoneNumberId: number.id,
        callerNumberWithheld: caller.withheld,
      });
      ids = { tenantId: job.tenantId, conversationId: created.conversationId };
      state = created.state;
      opening = created.greeting;
    }
    const jobLog = log.child({ conversationId: ids.conversationId, channel: job.kind });

    const voiceChoice = voiceFor(agentCtx.persona.id, agentCtx.voiceIds);
    // Keys passed explicitly: the plugins' default env names differ from ours (ELEVEN_API_KEY).
    const stt = new deepgram.STT({
      apiKey: process.env.DEEPGRAM_API_KEY,
      model: "nova-3",
      language: sttLanguageFor(state.language),
      smartFormat: true,
      // We never take card payments by voice; strip card numbers from transcripts anyway.
      redact: "pci",
    });
    const tts = new elevenlabs.TTS({
      apiKey: process.env.ELEVENLABS_API_KEY,
      voiceId: voiceChoice.voiceId,
      model: voiceChoice.model,
      language: state.language,
    });

    const publish = (payload: object) => {
      const data = new TextEncoder().encode(JSON.stringify(payload));
      void ctx.room.localParticipant
        ?.publishData(data, { reliable: true, topic: METRICS_TOPIC })
        .catch(() => undefined);
    };

    // Set when the agent closes the conversation; the call ends once the goodbye is heard.
    let hangUpAfterSpeech = false;
    const bridge = new EngineBridge(
      {
        db,
        llm,
        embeddings: await embeddings,
        calendars: { ...calendars, log: (msg, data) => log.warn(data, msg) },
      },
      agentCtx,
      ids,
      state,
      {
        onLanguage: (language) => {
          stt.updateOptions({ language: sttLanguageFor(language) });
          tts.updateOptions({ language });
          jobLog.info({ language }, "switched speech language");
        },
        onTurn: (result) => {
          if (result.state.endRequested) hangUpAfterSpeech = true;
          publish({ type: "turn", flow: result.state.flow, records: result.state.records });
        },
        onError: (error) => jobLog.error({ err: error }, "voice turn failed"),
      },
    );

    const session = new voice.AgentSession({
      // Silero VAD inside LiveKit's native local-inference binary. The onnxruntime-node
      // Silero plugin is avoided: on Windows its runtime (1.24) clashes with the one the
      // embeddings model needs (1.30) when both load in one process.
      vad: new inference.VAD(),
      stt,
      tts,
      llm: new EngineLlmPlaceholder(),
      userAwayTimeout: SILENCE_SECONDS,
      turnHandling: {
        // Local multilingual end-of-turn model (free, CPU); covers all six languages.
        turnDetection: new inference.TurnDetector({ version: "v1-mini" }),
        // Never start a turn on a partial transcript: turns can create bookings and tickets.
        preemptiveGeneration: { enabled: false },
        // Default waits up to 2.5 s when the detector thinks the caller may go on; in the
        // first live test a third of turns hit that cap.
        endpointing: { maxDelay: 1500 },
      },
    });

    // Per-turn latency: end of speech → turn committed → engine first text → TTS first audio.
    const latencies: TurnTimings[] = [];
    let pending: TurnTimings = {};
    session.on(voice.AgentSessionEventTypes.MetricsCollected, ({ metrics: m }) => {
      if (m.type === "eou_metrics") {
        pending = {
          endOfUtteranceMs: Math.round(m.endOfUtteranceDelayMs),
          transcriptionMs: Math.round(m.transcriptionDelayMs),
        };
      } else if (m.type === "tts_metrics" && !m.cancelled) {
        const last = latencies.at(-1);
        if (last && last.ttsFirstByteMs === undefined && last.llmFirstTextMs !== undefined) {
          last.ttsFirstByteMs = Math.round(m.ttfbMs);
          publish({ type: "latency", turn: latencies.length, ...last });
        }
      }
    });
    // End-of-turn decisions (numbers only), for tuning the detector threshold.
    session.on(voice.AgentSessionEventTypes.EotPrediction, (e) => {
      jobLog.info(
        {
          probability: Math.round(e.probability * 1000) / 1000,
          threshold: e.threshold,
          inferenceMs: Math.round(e.inferenceDurationMs),
          delayMs: Math.round(e.delayMs),
        },
        "end-of-turn prediction",
      );
    });

    const hangUp = async (reason: string) => {
      jobLog.info({ reason }, "hanging up");
      await ctx.deleteRoom().catch(() => undefined);
      ctx.shutdown(reason);
    };
    // Hang up once the closing goodbye has finished playing.
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (e) => {
      if (hangUpAfterSpeech && e.oldState === "speaking" && e.newState !== "speaking") {
        hangUpAfterSpeech = false;
        void hangUp("conversation closed");
      }
    });
    // Silence: ask once, then say goodbye and end the call.
    const silence = new SilenceHandler({
      stillThere: () => session.say(stillTherePhrase(bridge.language)).waitForPlayout(),
      goodbye: async () => {
        await session.say(silentGoodbyePhrase(bridge.language)).waitForPlayout();
        await hangUp("caller silent");
      },
    });
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (e) => {
      void silence.onUserState(e.newState).catch(() => undefined);
    });
    session.on(voice.AgentSessionEventTypes.Close, () => ctx.shutdown("session closed"));

    const agent = new EngineVoiceAgent(bridge, {
      pending: () => {
        const p = pending;
        pending = {};
        return p;
      },
      report: (t) => {
        if (!latencies.includes(t)) latencies.push(t);
        publish({ type: "latency", turn: latencies.indexOf(t) + 1, ...t });
      },
    });

    ctx.addShutdownCallback(async () => {
      await bridge.drain();
      const turns = latencies.map((t) => ({
        endOfUtteranceMs: t.endOfUtteranceMs,
        llmFirstTextMs: t.llmFirstTextMs,
        ttsFirstByteMs: t.ttsFirstByteMs,
        filler: t.filler,
        totalMs:
          t.ttsFirstByteMs === undefined || t.llmFirstTextMs === undefined
            ? undefined
            : (t.endOfUtteranceMs ?? 0) + t.llmFirstTextMs + t.ttsFirstByteMs,
      }));
      const medianMs = median(turns.map((t) => t.totalMs));
      jobLog.info({ turns: turns.length, medianVoiceToVoiceMs: medianMs }, "voice call ended");
      await saveVoiceMetrics(db, ids, { turns, medianMs }).catch((err: unknown) =>
        jobLog.error({ err }, "saving voice metrics failed"),
      );
      if (recorder && recorder.durationSeconds > 1) {
        await saveRecording(db, storage(), ids, recorder.toWav()).catch((err: unknown) =>
          jobLog.error({ err }, "saving the recording failed"),
        );
      }
      if (await endConversation(db, ids.tenantId, ids.conversationId)) {
        const redis = createRedisConnection(process.env.REDIS_URL!);
        const queue = createAiQueue(redis);
        await queue.add("conversation.summarize", { kind: "conversation.summarize", ...ids });
        await queue.close();
        redis.disconnect();
      }
    });

    // record: false keeps audio and transcripts out of LiveKit Cloud's session reports.
    await session.start({ agent, room: ctx.room, record: false });
    if (recorder && session.output.audio) {
      session.output.audio = new TeeAudioOutput(session.output.audio, {
        onFrame: (frame) => recorder.addAgent(frame),
        onClear: () => recorder.interruptAgent(),
      });
    }
    // The fixed greeting (AI disclosure, plus recording notice) is spoken word for word.
    if (opening) session.say(opening, { allowInterruptions: false });
  },
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    log.warn("LIVEKIT_URL, LIVEKIT_API_KEY or LIVEKIT_API_SECRET not set in .env; voice agent off");
  } else {
    cli.runApp(
      new ServerOptions({
        agent: fileURLToPath(import.meta.url),
        agentName: AGENT_NAME,
        // Health check: GET http://localhost:4200/
        port: Number(process.env.VOICE_AGENT_PORT ?? 4200),
      }),
    );
  }
}
