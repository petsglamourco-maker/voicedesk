"use client";

import { Alert, Badge, Button, Card, CardTitle, cn } from "@voicedesk/ui";
import { Room, RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

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

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="flex h-[560px] flex-col p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                "inline-block size-2.5 rounded-full",
                ended
                  ? "bg-muted-foreground"
                  : agentState === "speaking"
                    ? "bg-primary"
                    : agentState === "thinking"
                      ? "bg-warning"
                      : "bg-success",
              )}
              aria-hidden
            />
            <span data-testid="agent-state">
              {ended ? t("ended") : t(`state.${agentState}` as "state.listening")}
            </span>
          </div>
          {!ended ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void roomRef.current?.disconnect()}
            >
              {t("hangUp")}
            </Button>
          ) : null}
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
          {segments.map((s) => (
            <div
              key={s.id}
              className={cn("flex", s.role === "caller" ? "justify-end" : "justify-start")}
            >
              <div
                dir="auto"
                className={cn(
                  "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                  s.role === "caller"
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-muted",
                )}
              >
                {s.text}
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <div ref={audioRef} hidden />
      </Card>

      <div className="space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Card className="p-4">
          <CardTitle className="text-base">{t("latency")}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t("latencyHint")}</p>
          <p className="mt-3 text-sm">
            {t("median")}{" "}
            <Badge
              data-testid="median-latency"
              className={cn(
                medianMs !== null && medianMs <= 800
                  ? "border-success/40 text-success"
                  : "border-warning/40 text-warning",
              )}
            >
              {medianMs === null ? "—" : `${medianMs} ms`}
            </Badge>
          </p>
          <table className="mt-3 w-full text-xs">
            <caption className="caption-bottom pt-2 text-start text-muted-foreground">
              {t("fillerHint")}
            </caption>
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-start font-normal">#</th>
                <th className="text-end font-normal">{t("colTurn")}</th>
                <th className="text-end font-normal">{t("colLlm")}</th>
                <th className="text-end font-normal">{t("colTts")}</th>
                <th className="text-end font-normal">{t("colTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {latency.map((l) => (
                <tr key={l.turn}>
                  <td>{l.turn}</td>
                  <td className="text-end">{l.endOfUtteranceMs ?? "—"}</td>
                  <td className="text-end" title={l.filler ? t("fillerHint") : undefined}>
                    {l.llmFirstTextMs ?? "—"}
                    {l.filler ? "*" : ""}
                  </td>
                  <td className="text-end">{l.ttsFirstByteMs ?? "—"}</td>
                  <td className="text-end font-medium">{total(l) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
