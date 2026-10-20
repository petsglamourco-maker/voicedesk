"use client";

import { Alert, Badge, Button, Card, CardDescription, CardTitle, Select } from "@voicedesk/ui";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { Softphone, type AnsweredCall, type CallContext } from "./softphone";

type Presence = "available" | "busy" | "away" | "offline";

interface Me {
  presence: Presence;
  businesses: Array<{ tenantId: string; name: string; source: string }>;
}

interface QueueChat {
  tenantId: string;
  businessName: string;
  threadId: string;
  channel: string;
  name: string | null;
  preview: string | null;
  lastMessageAt: string;
  assignedToMe: boolean;
}

interface RingingCall {
  id: string;
  tenantId: string;
  businessName: string;
  reason: string | null;
  urgent: boolean;
  queuedAt: string;
  callerPhone: string | null;
  callerName: string | null;
}

interface Queue {
  calls: RingingCall[];
  chats: QueueChat[];
}

/** A short two-tone ring, repeated while a call waits (Web Audio: no sound files). */
function ringOnce(audio: AudioContext) {
  for (const [offset, freq] of [
    [0, 880],
    [0.25, 660],
  ] as const) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start(audio.currentTime + offset);
    osc.stop(audio.currentTime + offset + 0.2);
  }
}

/** The console sends its status this often; the server treats 60 s of silence as offline. */
const HEARTBEAT_MS = 20_000;

const CHANNEL_ICON: Record<string, string> = {
  web_chat: "💬",
  whatsapp: "🟢",
  email: "✉️",
  web_form: "📝",
};

export function VaConsole() {
  const t = useTranslations("va");
  const common = useTranslations("common");
  const format = useFormatter();
  const [me, setMe] = useState<Me | null>(null);
  const [presence, setPresenceState] = useState<Presence>("offline");
  const [chats, setChats] = useState<QueueChat[]>([]);
  const [calls, setCalls] = useState<RingingCall[]>([]);
  const [onCall, setOnCall] = useState<AnsweredCall | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<AudioContext | null>(null);
  // Clock for "waiting 12s", ticking only while calls ring.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (calls.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [calls.length]);

  const loadQueue = useCallback(async () => {
    const res = await api<Queue>("/api/va/queue");
    setChats(res.chats);
    setCalls(res.calls);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Me>("/api/va/me"), api<Queue>("/api/va/queue")])
      .then(([m, q]) => {
        if (cancelled) return;
        setMe(m);
        setPresenceState(m.presence);
        setChats(q.chats);
        setCalls(q.calls);
      })
      .catch(() => {
        if (!cancelled) setError(common("errorGeneric"));
      });
    return () => {
      cancelled = true;
    };
  }, [common]);

  // Heartbeat while not offline, and go offline when the tab closes.
  useEffect(() => {
    if (presence === "offline") return;
    const beat = () =>
      void api("/api/va/presence", { method: "PUT", body: JSON.stringify({ status: presence }) });
    const timer = setInterval(beat, HEARTBEAT_MS);
    const leave = () =>
      void fetch("/api/va/presence", {
        method: "PUT",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "offline" }),
      });
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
    };
  }, [presence]);

  useEffect(() => {
    const es = new EventSource("/api/va/stream");
    es.onmessage = () => void loadQueue();
    return () => es.close();
  }, [loadQueue]);

  // Ring while a call waits and this person can take it.
  const ringing = presence === "available" && !onCall && calls.length > 0;
  useEffect(() => {
    if (!ringing || !audio.current) return;
    const ctx = audio.current;
    ringOnce(ctx);
    const timer = setInterval(() => ringOnce(ctx), 2500);
    return () => clearInterval(timer);
  }, [ringing]);

  async function answer(call: RingingCall) {
    setAnswering(call.id);
    setError(null);
    try {
      const res = await api<{
        url: string;
        token: string;
        handoffId: string;
        context: CallContext | null;
      }>(`/api/tenants/${call.tenantId}/handoffs/${call.id}/answer`, { method: "POST" });
      setOnCall({ ...res, tenantId: call.tenantId, businessName: call.businessName });
      setPresenceState("busy");
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
      void loadQueue();
    } finally {
      setAnswering(null);
    }
  }

  function callFinished() {
    setOnCall(null);
    setPresenceState("available");
    void loadQueue();
  }

  async function changePresence(next: Presence) {
    setError(null);
    // Browsers only allow sound after a click: this is it, so the ringtone can play later.
    audio.current ??= new AudioContext();
    try {
      await api("/api/va/presence", { method: "PUT", body: JSON.stringify({ status: next }) });
      setPresenceState(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    }
  }

  if (!me) {
    return error ? <Alert tone="error">{error}</Alert> : null;
  }
  if (me.businesses.length === 0) {
    return (
      <Card>
        <CardTitle>{t("notAnswerer")}</CardTitle>
        <CardDescription>{t("notAnswererHint")}</CardDescription>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("answeringFor", { businesses: me.businesses.map((b) => b.name).join(", ") })}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <label htmlFor="presence" className="text-sm font-medium">
            {t("status")}
          </label>
          <Select
            id="presence"
            value={presence}
            onChange={(e) => void changePresence(e.target.value as Presence)}
            data-testid="va-presence"
          >
            <option value="available">{t("presence.available")}</option>
            <option value="busy">{t("presence.busy")}</option>
            <option value="away">{t("presence.away")}</option>
            <option value="offline">{t("presence.offline")}</option>
          </Select>
        </div>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {presence !== "available" && !onCall ? (
        <Alert tone="info">{t("notAvailableHint")}</Alert>
      ) : null}

      {onCall ? <Softphone call={onCall} onDone={callFinished} /> : null}

      <Card className="p-0">
        <div className="border-b border-border px-4 py-3">
          <CardTitle className="text-base">{t("callsTitle")}</CardTitle>
          <CardDescription>{t("callsHint")}</CardDescription>
        </div>
        {calls.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("callsEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="va-calls">
            {calls.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-success" />
                <Badge>{c.businessName}</Badge>
                {c.urgent ? (
                  <Badge className="border-danger/40 text-danger">{t("urgent")}</Badge>
                ) : null}
                <span className="font-medium" dir="auto">
                  {c.callerName ?? c.callerPhone ?? t("unknownCaller")}
                </span>
                <span className="flex-1 truncate text-muted-foreground" dir="auto">
                  {c.reason}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("waiting", {
                    seconds: Math.max(0, Math.round((now - Date.parse(c.queuedAt)) / 1000)),
                  })}
                </span>
                <Button
                  size="sm"
                  disabled={Boolean(onCall) || answering !== null}
                  onClick={() => void answer(c)}
                >
                  {answering === c.id ? t("answering") : t("answer")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-0">
        <div className="border-b border-border px-4 py-3">
          <CardTitle className="text-base">{t("chatsTitle")}</CardTitle>
          <CardDescription>{t("chatsHint")}</CardDescription>
        </div>
        {chats.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("chatsEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="va-chats">
            {chats.map((c) => (
              <li key={c.threadId}>
                <Link
                  href={`/t/${c.tenantId}/inbox/${c.threadId}`}
                  className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted"
                >
                  <span aria-hidden>{CHANNEL_ICON[c.channel] ?? "•"}</span>
                  <Badge>{c.businessName}</Badge>
                  <span className="font-medium" dir="auto">
                    {c.name ?? t("unknownCustomer")}
                  </span>
                  <span className="flex-1 truncate text-muted-foreground" dir="auto">
                    {c.preview}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format.relativeTime(new Date(c.lastMessageAt))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
