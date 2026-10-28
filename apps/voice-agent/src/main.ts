import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SipClient } from "livekit-server-sdk";
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
  backWithAssistantPhrase,
  createConversation,
  departmentByKey,
  departmentChosenPhrase,
  demoTimeUpPhrase,
  endConversation,
  menuActive,
  menuLine,
  personRequestText,
  ringFirstMissedPhrase,
  tryTeamPhrase,
  finishOutboundAttempt,
  outboundCallById,
  voicemailMessage,
  loadAgentContext,
  loadConversationState,
  nobodyFreePhrase,
  normalisePhone,
  PEOPLE_TARGET,
  silentGoodbyePhrase,
  stillConnectingPhrase,
  throughToPhrase,
  stillTherePhrase,
  sttLanguageFor,
  transferFailedPhrase,
  voiceFor,
  type ConversationState,
  type DepartmentInfo,
} from "@voicedesk/agent-brain";
import { createLogger } from "@voicedesk/compliance/logger";
import { loadRootEnv } from "@voicedesk/config/load-env";
import {
  availableAnswerers,
  departmentPeople,
  calendarsFromEnv,
  createAppLlm,
  createHandoff,
  getHandoff,
  moveHandoff,
  SecretBox,
  type CalendarFactory,
} from "@voicedesk/core";
import { createDb, type Database } from "@voicedesk/db";
import {
  createAiQueue,
  createNotificationQueue,
  createRedisConnection,
  LIVE_CHANNEL,
  type NotificationJob,
} from "@voicedesk/jobs";
import { EngineLlmPlaceholder, EngineVoiceAgent } from "./agent";
import { EngineBridge, median, type TurnTimings } from "./bridge";
import { HandoffController } from "./handoff";
import { OutboundOpener } from "./outbound";
import {
  activePhoneNumber,
  callerFromSip,
  forwardedFromSip,
  loadGreeting,
  parseJobMetadata,
  ringSecondsFor,
  saveRecording,
  saveVoiceMetrics,
  type JobIds,
} from "./job";
import { CallRecorder, RECORDING_SAMPLE_RATE } from "./recorder";
import { SILENCE_SECONDS, SilenceHandler } from "./silence";
import { TeeAudioOutput } from "./tee-output";

/** People answering from the VA console join with identity va-<userId> (see apps/api). */
function isConsolePerson(identity: string): boolean {
  return identity.startsWith("va-");
}

/** How long an outbound call may ring before it counts as unanswered. */
const OUTBOUND_RING_MS = 50_000;

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
      notify: (job: NotificationJob) => Promise<void>;
      /** Live events for the VA console (Redis pub/sub, then API, then browsers). */
      publishLive: (event: { tenantId: string; threadId: string; type: string }) => void;
    }
  | undefined;
function resources() {
  if (!shared) {
    const db = createDb(process.env.DATABASE_URL!);
    const box = SecretBox.fromEnv();
    shared = {
      db,
      calendars: { box, factory: calendarsFromEnv().factory },
      notify: (() => {
        let queue: ReturnType<typeof createNotificationQueue> | undefined;
        return async (job: NotificationJob) => {
          queue ??= createNotificationQueue(createRedisConnection(process.env.REDIS_URL!));
          await queue.add(job.kind, job);
        };
      })(),
      publishLive: (() => {
        let redis: ReturnType<typeof createRedisConnection> | undefined;
        return (event: { tenantId: string; threadId: string; type: string }) => {
          redis ??= createRedisConnection(process.env.REDIS_URL!);
          void redis.publish(LIVE_CHANNEL, JSON.stringify(event)).catch(() => undefined);
        };
      })(),
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
  // Load the database pool and the embeddings model while the process waits for a call, so a
  // burst of calls doesn't each pay the start-up cost (or hit the start-up time limit).
  prewarm: async () => {
    await resources().embeddings;
  },
  entry: async (ctx: JobContext) => {
    const job = parseJobMetadata(ctx.job.metadata);
    const resourcesNow = resources();
    const { db, llm, embeddings, storage, calendars, publishLive } = resourcesNow;
    // ADR 0029: an instant demo never sends anything (confirmations, alerts, ringing).
    const demo = job.kind === "browser" && job.demo === true;
    const notify: typeof resourcesNow.notify = demo ? async () => {} : resourcesNow.notify;
    const agentCtx = await loadAgentContext(db, job.tenantId, "voice");
    await ctx.connect();

    // Recording starts with the call (only when the business records calls).
    const recorder = agentCtx.recordCalls ? new CallRecorder() : null;
    const recordCaller = (track: RemoteTrack, participant: RemoteParticipant) => {
      if (!recorder || track.kind !== TrackKind.KIND_AUDIO) return;
      if (participant.identity === ctx.room.localParticipant?.identity) return;
      // A person from the VA console is on the business's side of the stereo recording.
      const business = isConsolePerson(participant.identity);
      void (async () => {
        for await (const frame of new AudioStream(track, RECORDING_SAMPLE_RATE, 1)) {
          if (business) recorder.addAgent(frame);
          else recorder.addCaller(frame);
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
    /** Phone calls: the department menu was spoken after the greeting (ADR 0025). */
    let offerMenu = false;
    /** Phone calls: ring the team right after the greeting (ADR 0025). */
    let ringAtStart = false;
    let opening: string | null;
    /** Phone calls: the caller's SIP participant (transfers act on it). */
    let callerIdentity: string | null = null;
    if (job.kind === "browser") {
      ids = { tenantId: job.tenantId, conversationId: job.conversationId };
      const stored = await loadConversationState(db, ids.tenantId, ids.conversationId);
      if (!stored || stored.status !== "active") {
        log.warn({ conversationId: ids.conversationId }, "conversation not active; not joining");
        return;
      }
      state = stored.state;
      opening = await loadGreeting(db, ids);
    } else if (job.kind === "outbound") {
      // Phase 6: a call the assistant placed. The conversation (with the fixed opening)
      // exists; the customer's phone is ringing.
      ids = { tenantId: job.tenantId, conversationId: job.conversationId };
      const stored = await loadConversationState(db, ids.tenantId, ids.conversationId);
      if (!stored || stored.status !== "active") return;
      state = stored.state;
      opening = await loadGreeting(db, ids);
      const answered = await Promise.race([
        ctx.waitForParticipant("customer"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), OUTBOUND_RING_MS)),
      ]);
      if (!answered) {
        const call = await outboundCallById(db, ids.tenantId, job.outboundCallId);
        if (call) {
          await finishOutboundAttempt(db, call, {
            status: "no_answer",
            conversationId: ids.conversationId,
          });
        }
        await endConversation(db, ids.tenantId, ids.conversationId);
        await ctx.deleteRoom().catch(() => undefined);
        return;
      }
      callerIdentity = answered.identity;
    } else {
      const number = await activePhoneNumber(db, job.tenantId, job.phoneNumberId);
      if (!number) {
        log.warn({ phoneNumberId: job.phoneNumberId }, "call to an inactive number; hanging up");
        await ctx.deleteRoom();
        return;
      }
      const participant = await ctx.waitForParticipant();
      callerIdentity = participant.identity;
      const caller = callerFromSip(participant.attributes);
      // ADR 0025: forwarded from the business's main line (missed by the team), or the
      // business says every call here is a backup; and the department menu when it's on.
      const entry = forwardedFromSip(participant.attributes)
        ? "forwarded"
        : agentCtx.callEntry === "backup"
          ? "backup"
          : "direct";
      offerMenu = menuActive(agentCtx.menu, agentCtx.profile, agentCtx.timezone, new Date());
      // Ring the team first (no menu): only when someone who answers calls is available.
      ringAtStart =
        !offerMenu &&
        agentCtx.ringFirst === true &&
        (await availableAnswerers(db, job.tenantId)).length > 0;
      const created = await createConversation(db, agentCtx, {
        entry,
        menu: offerMenu ? "voice" : null,
        ringFirst: ringAtStart,
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
    // Set when the caller is being put through to a person; done once the sentence is heard.
    let transferAfterSpeech: { to: string; fallback?: string; urgent?: boolean } | null = null;
    let handoffReason: string | null = null;
    // Ring-first (ADR 0025): the department whose team to ring once the reply is spoken.
    let ringAfterSpeech: DepartmentInfo | null = null;
    let lastDepartmentId: string | null = null;
    // Phase 6 outbound calls: how the call opened, and whether we left a voicemail.
    let opener: OutboundOpener | null = null;
    let voicemailLeft = false;
    const bridge = new EngineBridge(
      {
        db,
        llm,
        embeddings: await embeddings,
        calendars: { ...calendars, log: (msg, data) => log.warn(data, msg) },
        notify: (event) => notify({ ...event, tenantId: ids.tenantId }),
        canTransfer: job.kind === "phone" || job.kind === "outbound",
        peopleAvailable:
          job.kind === "phone" || job.kind === "outbound"
            ? async (only?: string[]) =>
                (await availableAnswerers(db, job.tenantId)).some(
                  (id) => !only?.length || only.includes(id),
                )
            : undefined,
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
        onTurn: (result, callerText) => {
          if (result.state.endRequested) hangUpAfterSpeech = true;
          // The caller named a department that rings its team first (ADR 0025).
          const chosen = result.state.department;
          if (chosen && chosen.id !== lastDepartmentId) {
            lastDepartmentId = chosen.id;
            const d = agentCtx.menu?.departments.find((x) => x.id === chosen.id);
            if (d?.ringFirst && !result.state.transfer) ringAfterSpeech = d;
          }
          if (result.state.transfer && callerIdentity) {
            transferAfterSpeech = result.state.transfer;
            handoffReason = callerText.slice(0, 200);
          }
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
    // Put the caller through (SIP REFER) once "I'll put you through" has been spoken.
    const transfer = async (to: string) => {
      jobLog.info("transferring call");
      try {
        const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
        const sip = new SipClient(
          LIVEKIT_URL!.replace(/^ws/, "http"),
          LIVEKIT_API_KEY,
          LIVEKIT_API_SECRET,
        );
        await sip.transferSipParticipant(ctx.room.name!, callerIdentity!, `tel:${to}`, {
          playDialtone: true,
          ringingTimeout: 30,
        });
        // The caller has left the room; the shutdown callback saves and summarises the call.
      } catch (err) {
        jobLog.warn({ err }, "transfer failed; offering a message instead");
        bridge.note(
          "The transfer to a person failed. You told the caller and offered to take a message; continue from there.",
        );
        session.say(transferFailedPhrase(bridge.language));
      }
    };
    // Phase 5: ring the VA console; the person joins this room from their browser.
    const ringMs = (await ringSecondsFor(db, ids.tenantId)) * 1000;
    const handoffLive = (id: string) =>
      publishLive({ tenantId: ids.tenantId, threadId: id, type: "handoff" });
    const say = (text: string) => void session.say(text);
    const handoff = new HandoffController(
      {
        open: async (reason, urgent, departmentId) => {
          const row = await createHandoff(db, {
            tenantId: ids.tenantId,
            conversationId: ids.conversationId,
            roomName: ctx.room.name!,
            reason,
            urgent,
            departmentId: departmentId ?? null,
          });
          handoffLive(row.id);
          // Phones of the people who answer calls (ADR 0024); never blocks the call.
          void notify({ kind: "call.ringing", tenantId: ids.tenantId, handoffId: row.id }).catch(
            () => undefined,
          );
          return row.id;
        },
        markMissed: async (id) => {
          const moved = await moveHandoff(db, ids.tenantId, id, ["waiting"], "missed");
          handoffLive(id);
          return moved !== null;
        },
        statusOf: async (id) => (await getHandoff(db, ids.tenantId, id))?.status ?? null,
        markReturned: async (id) => {
          await moveHandoff(db, ids.tenantId, id, ["answered"], "returned");
          handoffLive(id);
        },
        markEnded: async (id) => {
          await moveHandoff(db, ids.tenantId, id, ["answered"], "ended");
          handoffLive(id);
        },
        sayStillConnecting: () => say(stillConnectingPhrase(bridge.language)),
        sayThroughTo: (name) => say(throughToPhrase(bridge.language, name)),
        sayNobodyFree: () => say(nobodyFreePhrase(bridge.language)),
        sayRingFirstMissed: () => say(ringFirstMissedPhrase(bridge.language)),
        sayBackWithAssistant: () => say(backWithAssistantPhrase(bridge.language)),
        transferToPhone: (to) => transfer(to),
        note: (text) => bridge.note(text),
        hangUp: (reason) => hangUp(reason),
        setHumanActive: (active) => {
          bridge.humanActive = active;
        },
        log: (message, data) => jobLog.info(data ?? {}, message),
      },
      ringMs,
    );
    ctx.room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (isConsolePerson(participant.identity)) {
        handoff.personJoined(participant.name || "a colleague");
      }
    });
    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (isConsolePerson(participant.identity)) void handoff.personLeft();
    });

    // Hang up or transfer once the closing sentence has finished playing.
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (e) => {
      if (e.oldState !== "speaking" || e.newState === "speaking") return;
      if (transferAfterSpeech) {
        const target = transferAfterSpeech;
        transferAfterSpeech = null;
        if (target.to === PEOPLE_TARGET) {
          void handoff.start({
            reason: handoffReason,
            urgent: target.urgent === true,
            fallback: target.fallback,
            departmentId: bridge.department?.id ?? null,
          });
        } else {
          void transfer(target.to);
        }
      } else if (ringAfterSpeech) {
        const d = ringAfterSpeech;
        ringAfterSpeech = null;
        void ringTeamFirst(d, true);
      } else if (hangUpAfterSpeech) {
        hangUpAfterSpeech = false;
        void hangUp("conversation closed");
      }
    });
    // Silence: ask once, then say goodbye and end the call.
    const silence = new SilenceHandler({
      menuPending: () => offerMenu && !bridge.department,
      repeatMenu: () =>
        session.say(menuLine(bridge.language, agentCtx.menu?.departments ?? [])).waitForPlayout(),
      stillThere: () => session.say(stillTherePhrase(bridge.language)).waitForPlayout(),
      goodbye: async () => {
        await session.say(silentGoodbyePhrase(bridge.language)).waitForPlayout();
        await hangUp("caller silent");
      },
    });
    session.on(voice.AgentSessionEventTypes.UserStateChanged, (e) => {
      // While a person has the call, quiet moments are theirs to handle.
      if (bridge.humanActive) return;
      void silence.onUserState(e.newState).catch(() => undefined);
    });
    session.on(voice.AgentSessionEventTypes.Close, () => ctx.shutdown("session closed"));

    /**
     * Ring the team first (ADR 0025): the department's people (or everyone who answers calls)
     * are rung through the VA console and their phones; nobody answers, the assistant helps.
     */
    const ringTeamFirst = async (d: DepartmentInfo | null, announce: boolean) => {
      if (handoff.state !== "idle" || bridge.humanActive) return false;
      const only = d ? await departmentPeople(db, ids.tenantId, d.id) : [];
      const free = (await availableAnswerers(db, ids.tenantId)).filter(
        (id) => only.length === 0 || only.includes(id),
      );
      if (free.length === 0) return false;
      jobLog.info({ department: d?.key ?? null }, "ringing the team first");
      if (announce) await session.say(tryTeamPhrase(bridge.language)).waitForPlayout();
      void handoff.start({
        reason: null,
        urgent: false,
        departmentId: d?.id ?? null,
        ringFirst: true,
      });
      return true;
    };

    // Keypad (ADR 0025): 1–9 picks a department without the AI, 0 asks for a person, * or #
    // repeats the menu. Only the caller's presses count.
    ctx.room.on(RoomEvent.DtmfReceived, (_code, digit, participant) => {
      if (!callerIdentity || participant.identity !== callerIdentity) return;
      if (bridge.humanActive || !agentCtx.menu?.departments.length) return;
      if (digit === "*" || digit === "#") {
        session.say(menuLine(bridge.language, agentCtx.menu.departments));
        return;
      }
      if (digit === "0") {
        session.interrupt();
        session.generateReply({ userInput: personRequestText(bridge.language) });
        return;
      }
      const chosen = departmentByKey(agentCtx.menu, Number(digit));
      if (!chosen) return;
      jobLog.info({ key: chosen.key }, "department chosen by keypad");
      const spoken = departmentChosenPhrase(bridge.language, chosen);
      session.interrupt();
      lastDepartmentId = chosen.id;
      void bridge.chooseDepartment(chosen, spoken).then(async () => {
        publish({ type: "department", key: chosen.key, name: chosen.name });
        if (chosen.ringFirst && (await ringTeamFirst(chosen, true))) return;
        session.say(spoken);
      });
    });

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
      await handoff.callEnded();
      if (job.kind === "outbound") {
        const call = await outboundCallById(db, ids.tenantId, job.outboundCallId);
        if (call && call.status === "calling") {
          await finishOutboundAttempt(
            db,
            call,
            voicemailLeft
              ? { status: "voicemail", conversationId: ids.conversationId }
              : opener?.state === "live" || opener?.state === "opening"
                ? { status: "answered", conversationId: ids.conversationId }
                : { status: "no_answer", conversationId: ids.conversationId },
          ).catch((err: unknown) => jobLog.error({ err }, "saving the outbound result failed"));
        }
      }
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
    await session.start({
      agent,
      room: ctx.room,
      record: false,
      // Listen to the caller only: a person joining from the VA console must not become the
      // user the assistant answers.
      ...(callerIdentity ? { inputOptions: { participantIdentity: callerIdentity } } : {}),
    });
    if (recorder && session.output.audio) {
      session.output.audio = new TeeAudioOutput(session.output.audio, {
        onFrame: (frame) => recorder.addAgent(frame),
        onClear: () => recorder.interruptAgent(),
      });
    }
    // The fixed greeting (AI disclosure, plus recording notice) is spoken word for word.
    if (job.kind === "outbound") {
      // Listen first: a person says "Hello?", an answering machine starts a greeting.
      opener = new OutboundOpener({
        setHold: (on) => {
          bridge.humanActive = on;
        },
        sayOpening: async () => {
          if (opening) await session.say(opening, { allowInterruptions: false }).waitForPlayout();
        },
        leaveVoicemail: async () => {
          voicemailLeft = true;
          await session
            .say(
              voicemailMessage(bridge.language, {
                name: agentCtx.personaName,
                business: agentCtx.businessName,
                number: job.callbackNumber ?? "",
              }),
              { allowInterruptions: false },
            )
            .waitForPlayout();
          await hangUp("voicemail");
        },
      });
      session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (e) => {
        if (e.isFinal) opener?.heard(e.transcript);
      });
      opener.answered();
    } else if (opening) {
      const greeted = session.say(opening, { allowInterruptions: false });
      if (ringAtStart) {
        void greeted.waitForPlayout().then(() => ringTeamFirst(null, false));
      }
    }
    // ADR 0029: demo calls are capped; the browser shows the same countdown.
    if (job.kind === "browser" && job.demo && job.maxSeconds) {
      const timer = setTimeout(() => {
        void (async () => {
          await session.say(demoTimeUpPhrase(bridge.language)).waitForPlayout();
          await hangUp("demo time limit");
        })().catch(() => undefined);
      }, job.maxSeconds * 1000);
      timer.unref();
      session.on(voice.AgentSessionEventTypes.Close, () => clearTimeout(timer));
    }
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
        // Keep reconnecting (every 10 s) through internet or DNS drops instead of giving up
        // after ~90 s (the default 10 tries); a phone line must come back on its own.
        maxRetry: 100_000,
        // Several callers at once: keep warm processes ready (LiveKit keeps none in dev mode),
        // and give a cold one time to start rather than dropping the call after 10 s.
        numIdleProcesses: Number(process.env.VOICE_IDLE_PROCESSES ?? 5),
        initializeProcessTimeout: 60_000,
        // Health check: GET http://localhost:4200/ (this computer only).
        host: process.env.VOICE_AGENT_HOST ?? "127.0.0.1",
        port: Number(process.env.VOICE_AGENT_PORT ?? 4200),
      }),
    );
  }
}
