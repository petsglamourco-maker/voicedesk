"use client";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Input,
  Label,
  PageHero,
  Select,
  StatusPill,
  cn,
} from "@voicedesk/ui";
import {
  BellRing,
  Building2,
  ChevronRight,
  Clock,
  Headset,
  Info,
  MessagesSquare,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Siren,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChannelDot } from "@/components/channels";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";
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

/** Pre-filled from a contact's Call button (/va?tenant=…&dial=…&contact=…). */
export interface DialRequest {
  tenantId: string;
  to: string;
  contactId: string | null;
}

export function VaConsole(props: { dial?: DialRequest | null }) {
  const t = useTranslations("va");
  const common = useTranslations("common");
  const format = useFormatter();
  const chatNow = useNow({ updateInterval: 60_000 });
  const [me, setMe] = useState<Me | null>(null);
  const [presence, setPresenceState] = useState<Presence>("offline");
  const [chats, setChats] = useState<QueueChat[]>([]);
  const [calls, setCalls] = useState<RingingCall[]>([]);
  const [onCall, setOnCall] = useState<AnsweredCall | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [dialling, setDialling] = useState(false);
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
      setOnCall({
        ...res,
        kind: "handoff",
        tenantId: call.tenantId,
        businessName: call.businessName,
      });
      setPresenceState("busy");
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
      void loadQueue();
    } finally {
      setAnswering(null);
    }
  }

  async function placeCall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const tenantId = formString(data, "tenantId");
    const business = me?.businesses.find((b) => b.tenantId === tenantId);
    setError(null);
    setDialling(true);
    try {
      const res = await api<{ url: string; token: string; conversationId: string; callee: string }>(
        `/api/tenants/${tenantId}/outbound-calls`,
        {
          method: "POST",
          body: JSON.stringify({
            to: formString(data, "to"),
            callback: data.get("callback") === "on",
            ...(props.dial?.contactId && props.dial.tenantId === tenantId
              ? { contactId: props.dial.contactId }
              : {}),
          }),
        },
      );
      setOnCall({
        kind: "outbound",
        tenantId,
        businessName: business?.name ?? "",
        handoffId: res.conversationId,
        url: res.url,
        token: res.token,
        callee: res.callee,
        context: null,
      });
      setPresenceState("busy");
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setDialling(false);
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
        <EmptyState
          icon={Headset}
          title={t("notAnswerer")}
          description={t("notAnswererHint")}
          className="py-10"
        />
      </Card>
    );
  }

  return (
    <div className="stagger space-y-6">
      <PageHero
        icon={<Headset />}
        eyebrow={t(`presence.${presence}`)}
        title={t("title")}
        description={t("answeringFor", { businesses: me.businesses.map((b) => b.name).join(", ") })}
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="presence" className="text-sm font-medium">
              {t("status")}
            </label>
            <Select
              id="presence"
              value={presence}
              onChange={(e) => void changePresence(e.target.value as Presence)}
              data-testid="va-presence"
              className="min-w-36"
            >
              <option value="available">{t("presence.available")}</option>
              <option value="busy">{t("presence.busy")}</option>
              <option value="away">{t("presence.away")}</option>
              <option value="offline">{t("presence.offline")}</option>
            </Select>
          </div>
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {presence !== "available" && !onCall ? (
        <Alert tone="info">{t("notAvailableHint")}</Alert>
      ) : null}
      {presence === "available" && !onCall ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{t("keepOpenHint")}</span>
        </p>
      ) : null}

      {onCall ? <Softphone call={onCall} onDone={callFinished} /> : null}

      {!onCall ? (
        <Card>
          <CardHead
            icon={<PhoneOutgoing />}
            title={t("dialTitle")}
            hint={t("dialHint")}
            color="var(--color-ch-outbound)"
          />
          <form
            onSubmit={(e) => void placeCall(e)}
            className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] lg:items-end [&>*]:min-w-0"
            data-testid="va-dial"
          >
            <div>
              <Label htmlFor="dial-business">{t("dialBusiness")}</Label>
              <Select
                id="dial-business"
                name="tenantId"
                defaultValue={props.dial?.tenantId ?? me.businesses[0]?.tenantId}
              >
                {me.businesses.map((b) => (
                  <option key={b.tenantId} value={b.tenantId}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="dial-to">{t("dialNumber")}</Label>
              <Input
                id="dial-to"
                name="to"
                type="tel"
                required
                defaultValue={props.dial?.to ?? ""}
                className="tabular"
              />
            </div>
            <label className="flex h-10 cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="callback"
                defaultChecked={Boolean(props.dial)}
                className="size-4 accent-primary"
              />
              {t("dialCallback")}
            </label>
            <Button type="submit" disabled={dialling} shape="pill">
              <PhoneOutgoing aria-hidden />
              {dialling ? t("dialling") : t("dial")}
            </Button>
          </form>
        </Card>
      ) : null}

      <section aria-labelledby="va-calls-title" className="space-y-3">
        <CardHead
          icon={<PhoneIncoming />}
          title={<span id="va-calls-title">{t("callsTitle")}</span>}
          hint={t("callsHint")}
          color="var(--color-success)"
          aside={
            calls.length > 0 ? (
              <StatusPill
                tone="success"
                icon={BellRing}
                live
                label={<span className="tabular">{calls.length}</span>}
              />
            ) : null
          }
        />
        {calls.length === 0 ? (
          <Card variant="ghost" className="p-0">
            <EmptyState icon={PhoneIncoming} title={t("callsEmpty")} className="py-8" />
          </Card>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0" data-testid="va-calls">
            {calls.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "glass relative overflow-hidden rounded-xl border p-5",
                  c.urgent ? "border-danger/50" : "border-success/50",
                  "shadow-[0_0_40px_-10px_color-mix(in_srgb,var(--color-success)_55%,transparent)]",
                )}
              >
                <div aria-hidden className="spotlight pointer-events-none absolute inset-0" />
                <div className="relative flex items-start gap-4">
                  <span
                    aria-hidden
                    className="relative flex size-14 shrink-0 items-center justify-center"
                  >
                    <span className="absolute inset-0 animate-glow-pulse rounded-full bg-success/45 blur-md" />
                    <span className="relative flex size-14 items-center justify-center rounded-full border border-success/50 bg-success/15 text-success ring-4 ring-success/15">
                      <PhoneIncoming className="size-6" />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="secondary">
                        <Building2 aria-hidden />
                        <span dir="auto">{c.businessName}</span>
                      </Badge>
                      {c.urgent ? (
                        <StatusPill tone="danger" icon={Siren} label={t("urgent")} />
                      ) : null}
                    </div>
                    <p
                      className="mt-2 truncate font-display text-xl font-semibold tracking-tight"
                      dir="auto"
                    >
                      {c.callerName ?? c.callerPhone ?? t("unknownCaller")}
                    </p>
                    {c.reason ? (
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground" dir="auto">
                        {c.reason}
                      </p>
                    ) : null}
                    <p className="tabular mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="size-3.5" aria-hidden />
                      {t("waiting", {
                        seconds: Math.max(0, Math.round((now - Date.parse(c.queuedAt)) / 1000)),
                      })}
                    </p>
                  </div>
                </div>
                <Button
                  size="lg"
                  shape="pill"
                  className="relative mt-4 w-full"
                  disabled={Boolean(onCall) || answering !== null}
                  onClick={() => void answer(c)}
                >
                  <Phone aria-hidden />
                  {answering === c.id ? t("answering") : t("answer")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="p-0">
        <div className="border-b border-border px-5 py-4">
          <CardHead
            icon={<MessagesSquare />}
            title={t("chatsTitle")}
            hint={t("chatsHint")}
            color="var(--color-secondary)"
            aside={
              chats.length > 0 ? (
                <Badge tone="secondary" className="tabular">
                  {chats.length}
                </Badge>
              ) : null
            }
          />
        </div>
        {chats.length === 0 ? (
          <EmptyState icon={MessagesSquare} title={t("chatsEmpty")} className="py-8" />
        ) : (
          <ul className="divide-y divide-border" data-testid="va-chats">
            {chats.map((c) => (
              <li key={c.threadId}>
                <Link
                  href={`/t/${c.tenantId}/inbox/${c.threadId}`}
                  className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-muted"
                >
                  <span className="relative shrink-0">
                    <Avatar name={c.name ?? t("unknownCustomer")} />
                    <ChannelDot
                      channel={c.channel}
                      size="sm"
                      glow={false}
                      className="absolute -end-1.5 -bottom-1 size-5 ring-2 ring-background [&_svg]:size-2.5"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-semibold" dir="auto">
                        {c.name ?? t("unknownCustomer")}
                      </span>
                      <Badge>
                        <span dir="auto">{c.businessName}</span>
                      </Badge>
                    </div>
                    {c.preview ? (
                      <p className="mt-0.5 truncate text-muted-foreground" dir="auto">
                        {c.preview}
                      </p>
                    ) : null}
                  </div>
                  <span className="tabular shrink-0 text-xs text-muted-foreground">
                    {format.relativeTime(new Date(c.lastMessageAt), chatNow)}
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
