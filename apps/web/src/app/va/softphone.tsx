"use client";

import { Alert, Badge, Button, Card, CardTitle, cn } from "@voicedesk/ui";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  Bot,
  Building2,
  FileText,
  Info,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  PhoneOutgoing,
  StickyNote,
  UserRound,
} from "lucide-react";
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
  /** "handoff": a caller the assistant put through; "outbound": a call this person placed. */
  kind: "handoff" | "outbound";
  tenantId: string;
  businessName: string;
  /** Handoff id, or the outbound call's conversation id. */
  handoffId: string;
  /** Outbound: who's being called. */
  callee?: string;
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
  const outbound = call.kind === "outbound";
  const base = outbound
    ? `/api/tenants/${call.tenantId}/outbound-calls/${call.handoffId}`
    : `/api/tenants/${call.tenantId}/handoffs/${call.handoffId}`;

  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    // Set when this effect is cleaned up (unmount, or React's dev double-mount): our own
    // disconnect must not look like the caller hanging up.
    let disposed = false;
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      audioRef.current?.appendChild(track.attach());
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });
    // The caller hung up, or the call was ended.
    room.on(RoomEvent.Disconnected, () => {
      if (disposed) return;
      // Outbound calls are logged as ended here too (it's idempotent).
      if (call.kind === "outbound") {
        void api(`/api/tenants/${call.tenantId}/outbound-calls/${call.handoffId}/end`, {
          method: "POST",
        }).catch(() => undefined);
      }
      onDone.current();
    });
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
      disposed = true;
      void room.disconnect();
    };
  }, [call.url, call.token, call.kind, call.tenantId, call.handoffId, t]);

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [connected]);

  useEffect(() => {
    if (outbound) return;
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
  }, [base, outbound]);

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
      if (outbound) return; // the API ended the room; Disconnected follows
      // Leaving the room is what tells the assistant to take over again (or the call ends).
      await roomRef.current?.disconnect();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
      setBusy(false);
    }
  }

  const name =
    call.callee ?? context?.contact?.fullName ?? context?.callerPhone ?? t("unknownCaller");
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <Card
      variant="hero"
      className="border-success/40 p-0 shadow-[0_0_48px_-10px_color-mix(in_srgb,var(--color-success)_45%,transparent)]"
      data-testid="softphone"
    >
      <div aria-hidden className="spotlight pointer-events-none absolute inset-0" />
      <div className="relative p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <span aria-hidden className="relative flex size-14 shrink-0 items-center justify-center">
            <span
              className={cn(
                "absolute inset-0 rounded-full blur-md",
                connected ? "animate-glow-pulse bg-success/45" : "animate-pulse bg-warning/40",
              )}
            />
            <span
              className={cn(
                "relative flex size-14 items-center justify-center rounded-full border",
                connected
                  ? "border-success/50 bg-success/15 text-success"
                  : "border-warning/50 bg-warning/15 text-warning",
              )}
            >
              {outbound ? <PhoneOutgoing className="size-6" /> : <PhoneCall className="size-6" />}
            </span>
          </span>
          <div className="min-w-0 flex-1 basis-48">
            <CardTitle className="truncate text-xl" dir="auto">
              {name}
            </CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge tone="secondary">
                <Building2 aria-hidden />
                <span dir="auto">{call.businessName}</span>
              </Badge>
              {context?.contact?.phone && context.contact.fullName ? (
                <span className="tabular text-sm text-muted-foreground" dir="ltr">
                  {context.contact.phone}
                </span>
              ) : null}
            </div>
          </div>
          <span
            className={cn(
              "tabular rounded-full border px-4 py-1.5 font-display font-semibold",
              connected
                ? "border-success/40 bg-success/10 text-2xl text-success shadow-[0_0_24px_-6px_var(--color-success)]"
                : "animate-pulse border-border bg-muted text-sm text-muted-foreground",
            )}
            aria-label={t("callTime")}
          >
            {connected ? `${mm}:${ss}` : t("connecting")}
          </span>
        </div>
        {error ? (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        ) : null}

        <div className="mt-6 flex flex-wrap items-start justify-center gap-6 sm:justify-start">
          <div className="flex flex-col items-center gap-1.5">
            <Button
              variant="secondary"
              shape="pill"
              size="icon"
              className={cn("size-14 [&_svg]:size-6", muted && "border-warning/50 text-warning")}
              onClick={() => void toggleMute()}
              disabled={!connected}
              aria-label={muted ? t("unmute") : t("mute")}
            >
              {muted ? <MicOff /> : <Mic />}
            </Button>
            <span aria-hidden className="text-xs text-muted-foreground">
              {muted ? t("unmute") : t("mute")}
            </span>
          </div>
          {outbound ? null : (
            <div className="flex flex-col items-center gap-1.5">
              <Button
                variant="secondary"
                shape="pill"
                size="icon"
                className="size-14 [&_svg]:size-6"
                onClick={() => void finish("return")}
                disabled={busy}
                aria-label={t("handBack")}
              >
                <Bot />
              </Button>
              <span aria-hidden className="max-w-28 text-center text-xs text-muted-foreground">
                {t("handBack")}
              </span>
            </div>
          )}
          <div className="flex flex-col items-center gap-1.5">
            <Button
              variant="danger"
              shape="pill"
              size="icon"
              className="size-14 [&_svg]:size-6"
              onClick={() => void finish("end")}
              disabled={busy}
              aria-label={t("hangUp")}
            >
              <PhoneOff />
            </Button>
            <span aria-hidden className="text-xs text-muted-foreground">
              {t("hangUp")}
            </span>
          </div>
          {context?.contact ? (
            <Link
              href={`/t/${call.tenantId}/contacts/${context.contact.id}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 self-center text-sm font-semibold text-secondary hover:underline sm:ms-auto"
            >
              <UserRound className="size-4" aria-hidden />
              {t("openContact")}
            </Link>
          ) : null}
        </div>

        {outbound ? (
          <Alert tone="info" className="mt-5">
            {t("outboundNote")}
          </Alert>
        ) : null}
        <div
          className={cn(
            "mt-6 grid gap-4 lg:grid-cols-[1fr_260px] [&>*]:min-w-0",
            outbound && "hidden",
          )}
        >
          <div
            className="h-72 space-y-2.5 overflow-y-auto rounded-xl border border-border bg-[color-mix(in_srgb,var(--color-surface)_55%,transparent)] p-3"
            data-testid="softphone-transcript"
          >
            {(context?.transcript ?? []).map((m, i) => {
              const caller = m.role === "caller";
              return (
                <div key={i} className={cn("flex", caller ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                      caller
                        ? "rounded-ss-sm border border-border bg-surface-raised"
                        : "rounded-se-sm border border-primary/30 bg-primary/12",
                    )}
                  >
                    <p
                      className={cn(
                        "mb-0.5 text-[11px] font-semibold",
                        caller ? "text-muted-foreground" : "text-primary",
                      )}
                    >
                      {caller ? t("callerLabel") : t("assistantLabel")}
                    </p>
                    <p dir="auto" className="whitespace-pre-wrap">
                      {m.text}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={bottom} />
          </div>
          <div className="space-y-4 text-sm">
            {context?.records.length ? (
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <FileText className="size-3.5" aria-hidden />
                  {t("records")}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {context.records.map((r) => (
                    <Badge key={r.reference} tone="primary" className="font-mono">
                      {r.reference}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {context?.contact?.notes ? (
              <div className="rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_55%,transparent)] p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <StickyNote className="size-3.5" aria-hidden />
                  {t("notes")}
                </p>
                <p className="mt-1 whitespace-pre-wrap" dir="auto">
                  {context.contact.notes}
                </p>
              </div>
            ) : null}
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{t("handBackHint")}</span>
            </p>
          </div>
        </div>
      </div>
      <div ref={audioRef} hidden />
    </Card>
  );
}
