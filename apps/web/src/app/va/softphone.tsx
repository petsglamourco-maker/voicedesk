"use client";

import { Alert, Badge, Button, Card, CardTitle, cn } from "@voicedesk/ui";
import { Room, RoomEvent, Track } from "livekit-client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";

export interface CallContext {
  conversationId: string;
  callerPhone: string | null;
  flow: string | null;
  records: Array<{ type: string; reference: string }>;
  contact: {
    id: string;
    fullName: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
  } | null;
  transcript: Array<{ role: string; text: string; at: string }>;
}

export interface AnsweredCall {
  tenantId: string;
  businessName: string;
  handoffId: string;
  url: string;
  token: string;
  context: CallContext | null;
}

/** The transcript so far is refreshed this often while on the call. */
const CONTEXT_REFRESH_MS = 4000;

/**
 * Browser softphone for a call the assistant handed over (Phase 5): joins the call's LiveKit
 * room with the microphone, shows who's calling and what was said, and offers mute, hand
 * back to the assistant, and hang up.
 */
export function Softphone(props: { call: AnsweredCall; onDone: () => void }) {
  const { call } = props;
  const t = useTranslations("va");
  const common = useTranslations("common");
  const [context, setContext] = useState(call.context);
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const onDone = useRef(props.onDone);
  const base = `/api/tenants/${call.tenantId}/handoffs/${call.handoffId}`;

  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      audioRef.current?.appendChild(track.attach());
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });
    // The caller hung up, or the call was ended.
    room.on(RoomEvent.Disconnected, () => onDone.current());
    void (async () => {
      try {
        await room.connect(call.url, call.token);
        await room.startAudio();
        await room.localParticipant.setMicrophoneEnabled(true);
        setConnected(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("connectFailed"));
      }
    })();
    return () => {
      void room.disconnect();
    };
  }, [call.url, call.token, t]);

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [connected]);

  useEffect(() => {
    let cancelled = false;
    const timer = setInterval(() => {
      api<{ status: string; context: CallContext | null }>(`${base}/context`)
        .then((res) => {
          if (!cancelled && res.context) setContext(res.context);
        })
        .catch(() => undefined);
    }, CONTEXT_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [base]);

  useEffect(() => {
    void bottom.current?.scrollIntoView({ block: "end" });
  }, [context?.transcript.length]);

  async function toggleMute() {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(muted);
    setMuted(!muted);
  }

  async function finish(action: "return" | "end") {
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/${action}`, { method: "POST" });
      // Leaving the room is what tells the assistant to take over again (or the call ends).
      await roomRef.current?.disconnect();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
      setBusy(false);
    }
  }

  const name = context?.contact?.fullName ?? context?.callerPhone ?? t("unknownCaller");
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <Card className="border-success/50" data-testid="softphone">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-block h-3 w-3 rounded-full",
            connected ? "bg-success" : "animate-pulse bg-warning",
          )}
          aria-hidden
        />
        <CardTitle className="text-lg" dir="auto">
          {name}
        </CardTitle>
        <Badge>{call.businessName}</Badge>
        {context?.contact?.phone && context.contact.fullName ? (
          <span className="text-sm text-muted-foreground">{context.contact.phone}</span>
        ) : null}
        <span className="ms-auto font-mono text-sm tabular-nums" aria-label={t("callTime")}>
          {connected ? `${mm}:${ss}` : t("connecting")}
        </span>
      </div>
      {error ? (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void toggleMute()} disabled={!connected}>
          {muted ? t("unmute") : t("mute")}
        </Button>
        <Button variant="secondary" onClick={() => void finish("return")} disabled={busy}>
          {t("handBack")}
        </Button>
        <Button
          className="bg-danger text-white hover:bg-danger/90"
          onClick={() => void finish("end")}
          disabled={busy}
        >
          {t("hangUp")}
        </Button>
        {context?.contact ? (
          <Link
            href={`/t/${call.tenantId}/contacts/${context.contact.id}`}
            target="_blank"
            className="ms-auto self-center text-sm text-primary hover:underline"
          >
            {t("openContact")}
          </Link>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]">
        <div
          className="h-72 space-y-2 overflow-y-auto rounded-md border border-border p-3"
          data-testid="softphone-transcript"
        >
          {(context?.transcript ?? []).map((m, i) => (
            <p key={i} className="text-sm" dir="auto">
              <span className="me-1 text-xs font-medium text-muted-foreground">
                {m.role === "caller" ? t("callerLabel") : t("assistantLabel")}
              </span>
              {m.text}
            </p>
          ))}
          <div ref={bottom} />
        </div>
        <div className="space-y-3 text-sm">
          {context?.records.length ? (
            <div>
              <p className="text-xs text-muted-foreground">{t("records")}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {context.records.map((r) => (
                  <Badge key={r.reference} className="font-mono">
                    {r.reference}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          {context?.contact?.notes ? (
            <div>
              <p className="text-xs text-muted-foreground">{t("notes")}</p>
              <p className="mt-1 whitespace-pre-wrap" dir="auto">
                {context.contact.notes}
              </p>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("handBackHint")}</p>
        </div>
      </div>
      <div ref={audioRef} hidden />
    </Card>
  );
}
