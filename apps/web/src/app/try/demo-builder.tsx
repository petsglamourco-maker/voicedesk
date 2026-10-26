"use client";

import { Alert, Button, Input, Label, buttonVariants, cn } from "@voicedesk/ui";
import { LoaderCircle, Mic, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Turnstile } from "@/components/turnstile";
import { api } from "@/lib/client-api";
import { VoiceCall, type VoiceSession } from "../t/[tenantId]/console/voice-call";

interface Status {
  status: "crawling" | "building" | "ready" | "failed";
  error: string | null;
  businessName: string | null;
  personaName: string | null;
  suggestions: string[];
  chatTurnsLeft: number;
  voiceCallsLeft: number;
  maxSeconds: number;
}

interface Line {
  role: "agent" | "caller";
  text: string;
}

// The visitor's demo key, remembered for this tab so a reload keeps the demo.
const STORE = "voicedesk.demo";
const listeners = new Set<() => void>();
function readKey(): string | null {
  try {
    return sessionStorage.getItem(STORE);
  } catch {
    return null;
  }
}
function writeKey(key: string | null) {
  try {
    if (key) sessionStorage.setItem(STORE, key);
    else sessionStorage.removeItem(STORE);
  } catch {
    // private window: the demo just isn't remembered on reload
  }
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The /try page: build a demo from a website, then chat or talk to it. */
export function DemoBuilder(props: { siteKey: string | null; voice: boolean }) {
  const t = useTranslations("tryDemo");
  const common = useTranslations("common");
  const key = useSyncExternalStore(subscribe, readKey, () => null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [human, setHuman] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [email, setEmail] = useState("");

  // Follow the build every two seconds until it's ready or failed.
  useEffect(() => {
    if (!key) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api<Status>("/api/public/demos/status", {
          headers: { "x-demo-key": key },
        });
        if (!live) return;
        setStatus(next);
        if (next.status === "crawling" || next.status === "building") {
          timer = setTimeout(() => void poll(), 2000);
        }
      } catch {
        if (live) writeKey(null);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const created = await api<{ key: string }>("/api/public/demos", {
        method: "POST",
        body: JSON.stringify({
          website: form.get("website"),
          businessName: form.get("businessName") || undefined,
          ...(email ? { email, consent } : {}),
          ...(human ? { human } : {}),
        }),
      });
      setStatus(null);
      writeKey(created.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  function startAgain() {
    setStatus(null);
    writeKey(null);
  }

  if (!key) {
    return (
      <form method="post" onSubmit={onSubmit} className="mt-6 space-y-4" data-testid="demo-form">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div>
          <Label htmlFor="website">{t("website")}</Label>
          <Input
            id="website"
            name="website"
            required
            inputMode="url"
            placeholder="www.yourbusiness.co.uk"
            className="h-11"
          />
        </div>
        <div>
          <Label htmlFor="businessName">{t("businessName")}</Label>
          <Input id="businessName" name="businessName" maxLength={120} className="h-11" />
        </div>
        <div>
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11"
          />
          {email ? (
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
              />
              <span>{t("consent")}</span>
            </label>
          ) : null}
        </div>
        {props.siteKey ? <Turnstile siteKey={props.siteKey} onToken={setHuman} /> : null}
        <p className="text-xs text-muted-foreground">{t("privacy")}</p>
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          <Sparkles aria-hidden />
          {pending ? common("working") : t("build")}
        </Button>
      </form>
    );
  }

  if (!status || status.status === "crawling" || status.status === "building") {
    return (
      <div
        className="mt-6 flex items-center gap-3 text-[15px]"
        role="status"
        data-testid="demo-building"
      >
        <LoaderCircle className="size-5 animate-spin text-primary" aria-hidden />
        <span>{status?.status === "building" ? t("building") : t("crawling")}</span>
      </div>
    );
  }

  if (status.status === "failed") {
    return (
      <div className="mt-6 space-y-4">
        <Alert tone="error">
          {status.error === "profile_failed" ? t("failedAi") : t("failedSite")}
        </Alert>
        <Button variant="secondary" onClick={startAgain}>
          {t("again")}
        </Button>
      </div>
    );
  }

  return <DemoReady demoKey={key} status={status} voice={props.voice} onAgain={startAgain} />;
}

function DemoReady(props: {
  demoKey: string;
  status: Status;
  voice: boolean;
  onAgain: () => void;
}) {
  const t = useTranslations("tryDemo");
  const common = useTranslations("common");
  const [lines, setLines] = useState<Line[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [turnsLeft, setTurnsLeft] = useState(props.status.chatTurnsLeft);
  const [callsLeft, setCallsLeft] = useState(props.status.voiceCallsLeft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [call, setCall] = useState<VoiceSession | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const headers = { "x-demo-key": props.demoKey };

  useEffect(() => {
    if (!call) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [call]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ conversationId: string; greeting: string | null; reply: string }>(
        "/api/public/demos/chat",
        { method: "POST", headers, body: JSON.stringify({ conversationId, text }) },
      );
      setConversationId(res.conversationId);
      setLines((l) => [
        ...l,
        ...(res.greeting ? [{ role: "agent" as const, text: res.greeting }] : []),
        { role: "caller", text },
        { role: "agent", text: res.reply },
      ]);
      setTurnsLeft((n) => n - 1);
      if (input.current) input.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function talk() {
    setError(null);
    try {
      const session = await api<VoiceSession & { maxSeconds: number }>("/api/public/demos/voice", {
        method: "POST",
        headers,
      });
      setSecondsLeft(session.maxSeconds);
      setCallsLeft((n) => n - 1);
      setCall(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    }
  }

  return (
    <div className="mt-6 space-y-5" data-testid="demo-ready">
      <p className="text-[15px]">
        {t("ready", {
          persona: props.status.personaName ?? "",
          business: props.status.businessName ?? "",
        })}
      </p>
      {error ? <Alert tone="error">{error}</Alert> : null}

      {call ? (
        <div className="space-y-2">
          <p className="tabular text-sm text-muted-foreground" role="timer">
            {t("timeLeft", { seconds: secondsLeft })}
          </p>
          <VoiceCall session={call} onEnded={() => setCall(null)} />
        </div>
      ) : props.voice && callsLeft > 0 ? (
        <Button size="lg" onClick={() => void talk()}>
          <Mic aria-hidden />
          {t("talk")}
        </Button>
      ) : null}

      <div className="rounded-lg border border-border p-4">
        <p className="text-sm font-medium">{t("chat")}</p>
        <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-[15px]" aria-live="polite">
          {lines.map((line, i) => (
            <li
              key={i}
              dir="auto"
              className={cn(
                "rounded-xl px-3 py-2",
                line.role === "agent" ? "me-8 bg-primary/10" : "ms-8 bg-muted text-end",
              )}
            >
              {line.text}
            </li>
          ))}
        </ul>
        {lines.length === 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {props.status.suggestions.map((s) => (
              <Button key={s} variant="secondary" size="sm" onClick={() => void send(s)}>
                {s}
              </Button>
            ))}
          </div>
        ) : null}
        {turnsLeft > 0 ? (
          <form
            method="post"
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input.current?.value ?? "");
            }}
          >
            <Input
              ref={input}
              name="text"
              maxLength={500}
              dir="auto"
              placeholder={t("ask")}
              className="h-11"
            />
            <Button type="submit" disabled={busy} className="h-11">
              <Send aria-hidden />
              {t("send")}
            </Button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t("usedUp")}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
          {t("signUp")}
        </Link>
        <Button variant="ghost" onClick={props.onAgain}>
          {t("again")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("expires")}</p>
    </div>
  );
}
