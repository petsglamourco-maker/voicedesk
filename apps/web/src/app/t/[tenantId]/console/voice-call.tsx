"use client";

import { Alert, Badge, Button, Card, CardHead, cn } from "@voicedesk/ui";
import { AudioLines, Bot, Gauge, Mic, PhoneOff, Sparkles, Timer, UserRound } from "lucide-react";
import { Room, RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface VoiceSession {
  conversationId: string;
  url: string;
  token: string;
  greeting: string;
  personaName: string;
}

interface Latency {
  turn: number;
  endOfUtteranceMs?: number;
  transcriptionMs?: number;
  llmFirstTextMs?: number;
  ttsFirstByteMs?: number;
  engineMs?: number;
  filler?: boolean;
}

interface Segment {
  id: string;
  role: "agent" | "caller";
  text: string;
}

/** Voice-to-voice estimate: end of speech → turn committed → first text → first audio. */
function total(l: Latency): number | null {
  if (l.ttsFirstByteMs === undefined || l.llmFirstTextMs === undefined) return null;
  return (l.endOfUtteranceMs ?? 0) + l.llmFirstTextMs + l.ttsFirstByteMs;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

const AGENT_JOIN_TIMEOUT_MS = 15_000;

/**
 * Browser voice call with the assistant over LiveKit (ADR 0013). Speech goes through the
 * same engine as chat; this shows the live transcript and where the latency goes.
 */
export function VoiceCall(props: { session: VoiceSession; onEnded: () => void }) {
  const t = useTranslations("voice");
  const [segments, setSegments] = useState<Segment[]>([
    { id: "greeting", role: "agent", text: props.session.greeting },
  ]);
  const [latency, setLatency] = useState<Latency[]>([]);
  const [agentState, setAgentState] = useState<string>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const onEnded = useRef(props.onEnded);

  useEffect(() => {
    void bottom.current?.scrollIntoView({ block: "end" });
  }, [segments]);

  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    let agentJoined = false;
    const joinTimer = setTimeout(() => {
      if (!agentJoined) setError(t("agentMissing"));
    }, AGENT_JOIN_TIMEOUT_MS);

    const watchAgent = (p: RemoteParticipant) => {
      agentJoined = true;
      setAgentState(p.attributes["lk.agent.state"] ?? "listening");
    };
    room.on(RoomEvent.ParticipantConnected, watchAgent);
    room.on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
      if (participant !== room.localParticipant && changed["lk.agent.state"]) {
        agentJoined = true;
        setAgentState(changed["lk.agent.state"]);
      }
    });
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      audioRef.current?.appendChild(el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });
    room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (topic !== "voicedesk.latency") return;
      const data = JSON.parse(new TextDecoder().decode(payload)) as { type: string } & Latency;
      if (data.type !== "latency") return;
      setLatency((rows) => {
        const copy = rows.filter((r) => r.turn !== data.turn);
        return [...copy, data].sort((a, b) => a.turn - b.turn);
      });
    });
    room.on(RoomEvent.Disconnected, () => {
      setEnded(true);
      onEnded.current();
    });

    // Live transcripts of both sides (published by the agent framework).
    room.registerTextStreamHandler("lk.transcription", (reader, participant) => {
      const role = participant.identity === room.localParticipant.identity ? "caller" : "agent";
      const id = reader.info.attributes?.["lk.segment_id"] ?? reader.info.id;
      void (async () => {
        for await (const delta of reader) {
          setSegments((list) => {
            const i = list.findIndex((s) => s.id === id);
            if (i === -1) return [...list, { id, role, text: delta }];
            const copy = [...list];
            copy[i] = { ...copy[i]!, text: copy[i]!.text + delta };
            return copy;
          });
        }
      })();
    });

    void (async () => {
      try {
        await room.connect(props.session.url, props.session.token);
        await room.startAudio();
        await room.localParticipant.setMicrophoneEnabled(true);
        room.remoteParticipants.forEach(watchAgent);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("connectFailed"));
      }
    })();

    return () => {
      clearTimeout(joinTimer);
      void room.disconnect();
    };
  }, [props.session.url, props.session.token, t]);

  const totals = latency.map(total).filter((v): v is number => v !== null);
  const medianMs = median(totals);
  const live = !ended && agentState !== "connecting";
  const stateColor = ended
    ? "var(--color-muted-foreground)"
    : agentState === "speaking"
      ? "var(--color-primary)"
      : agentState === "thinking"
        ? "var(--color-warning)"
        : "var(--color-success)";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] [&>*]:min-w-0">
      <Card
        className={cn(
          "flex h-[560px] flex-col overflow-hidden p-0 transition-[border-color,box-shadow] duration-500",
          live && "border-primary/35 shadow-[0_0_40px_-10px_var(--color-glow)]",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border bg-[color-mix(in_srgb,var(--color-surface)_50%,transparent)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <span
              aria-hidden
              className="relative flex size-10 shrink-0 items-center justify-center"
            >
              {live ? (
                <span
                  className="absolute inset-0 animate-glow-pulse rounded-full blur-md"
                  style={{ background: stateColor, opacity: 0.45 }}
                />
              ) : null}
              <span
                className="relative flex size-10 items-center justify-center rounded-full [&_svg]:size-[18px]"
                style={{
                  color: stateColor,
                  background: `color-mix(in srgb, ${stateColor} 16%, transparent)`,
                  boxShadow: live
                    ? `0 0 0 1px color-mix(in srgb, ${stateColor} 45%, transparent)`
                    : undefined,
                }}
              >
                {ended ? (
                  <PhoneOff />
                ) : agentState === "speaking" ? (
                  <AudioLines className="animate-glow-pulse" />
                ) : agentState === "thinking" ? (
                  <Sparkles className="animate-glow-pulse" />
                ) : (
                  <Mic className={cn(live && "animate-glow-pulse")} />
                )}
              </span>
            </span>
            <div className="min-w-0">
              <p className="truncate font-display font-semibold" dir="auto">
                {props.session.personaName}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={cn("inline-block size-2 rounded-full", live && "animate-glow-pulse")}
                  style={{ background: stateColor }}
                  aria-hidden
                />
                <span data-testid="agent-state">
                  {ended ? t("ended") : t(`state.${agentState}` as "state.listening")}
                </span>
              </p>
            </div>
          </div>
          {!ended ? (
            <Button
              variant="danger"
              size="sm"
              shape="pill"
              onClick={() => void roomRef.current?.disconnect()}
            >
              <PhoneOff aria-hidden />
              {t("hangUp")}
            </Button>
          ) : null}
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {segments.map((s) => (
            <ChatBubble key={s.id} role={s.role}>
              {s.text}
            </ChatBubble>
          ))}
          <div ref={bottom} />
        </div>
        <div ref={audioRef} hidden />
      </Card>

      <div className="space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Card className="p-5">
          <CardHead
            icon={<Gauge />}
            title={t("latency")}
            hint={t("latencyHint")}
            color="var(--color-ch-outbound)"
          />
          <p className="mt-4 flex items-center gap-2 text-sm">
            {t("median")}{" "}
            <Badge
              data-testid="median-latency"
              tone={medianMs !== null && medianMs <= 800 ? "success" : "warning"}
              className="tabular px-3 py-1 text-sm"
            >
              <Timer aria-hidden />
              {medianMs === null ? "—" : `${medianMs} ms`}
            </Badge>
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="tabular w-full text-xs">
              <caption className="caption-bottom pt-3 text-start text-muted-foreground">
                {t("fillerHint")}
              </caption>
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="pb-2 text-start font-medium">#</th>
                  <th className="pb-2 text-end font-medium">{t("colTurn")}</th>
                  <th className="pb-2 text-end font-medium">{t("colLlm")}</th>
                  <th className="pb-2 text-end font-medium">{t("colTts")}</th>
                  <th className="pb-2 text-end font-medium">{t("colTotal")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {latency.map((l) => {
                  const sum = total(l);
                  return (
                    <tr key={l.turn} className="animate-rise">
                      <td className="py-1.5 text-muted-foreground">{l.turn}</td>
                      <td className="py-1.5 text-end">{l.endOfUtteranceMs ?? "—"}</td>
                      <td
                        className="py-1.5 text-end"
                        title={l.filler ? t("fillerHint") : undefined}
                      >
                        {l.llmFirstTextMs ?? "—"}
                        {l.filler ? "*" : ""}
                      </td>
                      <td className="py-1.5 text-end">{l.ttsFirstByteMs ?? "—"}</td>
                      <td className="py-1.5 text-end">
                        {sum === null ? (
                          "—"
                        ) : (
                          <Badge tone={sum <= 800 ? "success" : sum <= 1500 ? "warning" : "danger"}>
                            {sum}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** One transcript bubble: the assistant on the start side, the customer on the end side. */
export function ChatBubble(props: {
  role: "agent" | "caller";
  children: ReactNode;
  /** Screen-reader prefix such as "You:" (visually hidden). */
  label?: string;
  /** Small line under the text (e.g. latency and cost). */
  meta?: ReactNode;
}) {
  const caller = props.role === "caller";
  return (
    <div className={cn("flex animate-rise items-end gap-2", caller && "flex-row-reverse")}>
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5",
          caller
            ? "bg-muted text-muted-foreground"
            : "bg-[linear-gradient(135deg,var(--color-primary),var(--color-secondary)_60%,var(--color-accent))] text-primary-foreground shadow-[0_0_14px_-3px_var(--color-glow)]",
        )}
      >
        {caller ? <UserRound /> : <Bot />}
      </span>
      <div
        dir="auto"
        className={cn(
          "max-w-[80%] min-w-0 rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap",
          caller
            ? "rounded-ee-md bg-primary text-primary-foreground shadow-[0_0_18px_-6px_var(--color-glow)]"
            : "glass rounded-es-md",
        )}
      >
        {props.label ? <span className="sr-only">{props.label} </span> : null}
        {props.children}
        {props.meta}
      </div>
    </div>
  );
}

/** Three softly pulsing dots while the assistant is composing a reply. */
export function TypingDots(props: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-1 py-1", props.className)}>
      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
      <span className="size-1.5 animate-pulse rounded-full bg-secondary [animation-delay:150ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-accent [animation-delay:300ms]" />
    </span>
  );
}
