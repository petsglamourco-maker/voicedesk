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
import type { EmbeddingProvider, LlmProvider } from "@voicedesk/adapters";
import { embeddingsFromEnv } from "@voicedesk/adapters/from-env";
import {
  endConversation,
  loadAgentContext,
  loadConversationState,
  sttLanguageFor,
  voiceFor,
} from "@voicedesk/agent-brain";
import { createLogger } from "@voicedesk/compliance/logger";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { createAppLlm, SecretBox } from "@voicedesk/core";
import { createDb, type Database } from "@voicedesk/db";
import { createAiQueue, createRedisConnection } from "@voicedesk/jobs";
import { EngineLlmPlaceholder, EngineVoiceAgent } from "./agent";
import { EngineBridge, median, type TurnTimings } from "./bridge";
import { loadGreeting, parseJobMetadata } from "./job";

/** Must match VOICE_AGENT_NAME in apps/api (explicit dispatch only). */
const AGENT_NAME = "voicedesk-agent";
/** Data-channel topic the browser test console reads latency from. */
const METRICS_TOPIC = "voicedesk.latency";

const envFile = loadRootEnv();
const repoRoot = envFile ? dirname(envFile) : process.cwd();
const log = createLogger("voice-agent", process.env.LOG_LEVEL ?? "info");

// Shared per job process: database pool, AI-provider router, embeddings model.
let shared: { db: Database; llm: LlmProvider; embeddings: Promise<EmbeddingProvider> } | undefined;
function resources() {
  if (!shared) {
    const db = createDb(process.env.DATABASE_URL!);
    shared = {
      db,
      llm: createAppLlm(db, {
        box: SecretBox.fromEnv(),
        anthropicEnvKey: process.env.ANTHROPIC_API_KEY || undefined,
      }),
      embeddings: embeddingsFromEnv(process.env, repoRoot),
    };
  }
  return shared;
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const ids = parseJobMetadata(ctx.job.metadata);
    const jobLog = log.child({ conversationId: ids.conversationId });
    const { db, llm, embeddings } = resources();
    const stored = await loadConversationState(db, ids.tenantId, ids.conversationId);
    if (!stored || stored.status !== "active") {
      jobLog.warn("conversation not found or already ended; not joining");
      return;
    }
    const agentCtx = await loadAgentContext(db, ids.tenantId, "voice");
    const { state } = stored;

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

    const bridge = new EngineBridge(
      { db, llm, embeddings: await embeddings },
      agentCtx,
      ids,
      state,
      {
        onLanguage: (language) => {
          stt.updateOptions({ language: sttLanguageFor(language) });
          tts.updateOptions({ language });
          jobLog.info({ language }, "switched speech language");
        },
        onTurn: (result) =>
          publish({ type: "turn", flow: result.state.flow, records: result.state.records }),
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
      turnHandling: {
        // Local multilingual end-of-turn model (free, CPU); covers all six languages.
        turnDetection: new inference.TurnDetector({ version: "v1-mini" }),
        // Never start a turn on a partial transcript: turns can create bookings and tickets.
        preemptiveGeneration: { enabled: false },
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
      const voiceToVoice = latencies.map((t) =>
        t.ttsFirstByteMs === undefined
          ? undefined
          : (t.endOfUtteranceMs ?? 0) + (t.llmFirstTextMs ?? 0) + t.ttsFirstByteMs,
      );
      jobLog.info(
        { turns: latencies.length, medianVoiceToVoiceMs: median(voiceToVoice) },
        "voice call ended",
      );
      if (await endConversation(db, ids.tenantId, ids.conversationId)) {
        const redis = createRedisConnection(process.env.REDIS_URL!);
        const queue = createAiQueue(redis);
        await queue.add("conversation.summarize", { kind: "conversation.summarize", ...ids });
        await queue.close();
        redis.disconnect();
      }
    });

    await ctx.connect();
    await session.start({ agent, room: ctx.room });
    // The fixed greeting (with the AI disclosure) was stored when the session was created,
    // so it is spoken word for word, never generated.
    const opening = await loadGreeting(db, ids);
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
