"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  Input,
  Label,
  Select,
  Skeleton,
} from "@voicedesk/ui";
import {
  ArrowLeftRight,
  Check,
  CircleCheck,
  Cpu,
  FileText,
  Languages,
  Play,
  RotateCcw,
  SendHorizontal,
  Square,
  Star,
  Timer,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LOCALES } from "@/i18n/locales";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";
import { postSse } from "@/lib/sse";
import { ChatBubble, TypingDots, VoiceCall, type VoiceSession } from "./voice-call";
import { ScreenHero } from "@/components/screen-hero";

interface View {
  flow: string;
  language: string;
  complaint: Record<string, unknown>;
  booking: Record<string, unknown>;
  message: Record<string, unknown>;
  records: Array<{ type: string; reference: string }>;
  turns: number;
}

interface Line {
  role: "agent" | "caller";
  text: string;
  meta?: { latencyMs: number; costUsd: number };
}

interface ToolEvent {
  type: string;
  name?: string;
  ok?: boolean;
  record?: { type: string; reference: string };
  language?: string;
}

interface Summary {
  intent?: string;
  outcome?: string;
  summary?: string;
  actionItems?: string[];
  sentiment?: string;
}

export function TestConsole({
  tenantId,
  defaultLanguage,
}: {
  tenantId: string;
  defaultLanguage: string;
}) {
  const t = useTranslations("console");
  const shell = useTranslations("shell");
  const languages = useTranslations("languages");
  const common = useTranslations("common");
  const base = `/api/tenants/${tenantId}/conversations`;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [events, setEvents] = useState<ToolEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [voice, setVoice] = useState<VoiceSession | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Block body: scrollIntoView returns a Promise in newer browsers, and an effect must
    // return nothing or a cleanup function.
    void bottom.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  // After ending, poll briefly for the summary produced by the worker.
  useEffect(() => {
    if (!ended || !conversationId || summary) return;
    const timer = setInterval(() => {
      void api<{ summary: Summary | null }>(`${base}/${conversationId}`).then((c) => {
        if (c.summary) setSummary(c.summary);
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [ended, conversationId, summary, base]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setEvents([]);
    setSummary(null);
    setEnded(false);
    setVoice(null);
    try {
      if (formString(form, "style") === "call") {
        const session = await api<VoiceSession>(`/api/tenants/${tenantId}/voice/session`, {
          method: "POST",
          body: JSON.stringify({ language: formString(form, "language") }),
        });
        setConversationId(session.conversationId);
        setLines([]);
        setView(null);
        setWarning(null);
        setVoice(session);
        return;
      }
      const res = await api<{ id: string; greeting: string; hasProfile: boolean; view: View }>(
        base,
        {
          method: "POST",
          body: JSON.stringify({
            style: formString(form, "style"),
            language: formString(form, "language"),
            callerPhone: formString(form, "callerPhone") || undefined,
          }),
        },
      );
      setConversationId(res.id);
      setLines([{ role: "agent", text: res.greeting }]);
      setView(res.view);
      setWarning(res.hasProfile ? null : t("noProfile"));
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversationId || busy) return;
    const formEl = event.currentTarget;
    const text = formString(new FormData(formEl), "text").trim();
    if (!text) return;
    formEl.reset();
    setBusy(true);
    setError(null);
    setLines((l) => [...l, { role: "caller", text }, { role: "agent", text: "" }]);
    const appendDelta = (delta: string) =>
      setLines((l) => {
        const copy = [...l];
        const last = copy.at(-1)!;
        copy[copy.length - 1] = { ...last, text: last.text + delta };
        return copy;
      });
    try {
      await postSse(`${base}/${conversationId}/messages`, { text }, (name, data) => {
        if (name === "delta") appendDelta((data as { text: string }).text);
        else if (name === "event") setEvents((e) => [...e, data as ToolEvent]);
        else if (name === "done") {
          const d = data as { reply: string; latencyMs: number; costUsd: number; view: View };
          setView(d.view);
          setLines((l) => {
            const copy = [...l];
            copy[copy.length - 1] = {
              role: "agent",
              text: d.reply,
              meta: { latencyMs: d.latencyMs, costUsd: d.costUsd },
            };
            return copy;
          });
        } else if (name === "error") setError((data as { message: string }).message);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  /** The voice worker ends the conversation when the call drops; this is the fallback. */
  function voiceEnded() {
    setEnded(true);
    const id = conversationId;
    if (id) {
      setTimeout(() => {
        void api(`${base}/${id}/end`, { method: "POST" }).catch(() => undefined);
      }, 8000);
    }
  }

  async function end() {
    if (!conversationId) return;
    await api(`${base}/${conversationId}/end`, { method: "POST" });
    setEnded(true);
  }

  const slots =
    view && ["complaint", "booking", "message"].includes(view.flow)
      ? view[view.flow as "complaint" | "booking" | "message"]
      : null;

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="console"
        eyebrow={shell("groups.assistant")}
        title={t("title")}
        description={t("subtitle")}
      />

      <Card>
        <form
          onSubmit={(e) => void start(e)}
          className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end [&>*]:min-w-0"
        >
          <div>
            <Label htmlFor="language">{t("startLanguage")}</Label>
            <Select
              id="language"
              name="language"
              defaultValue={defaultLanguage}
              className="lg:w-48"
            >
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {languages(code)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="style">{t("style")}</Label>
            <Select id="style" name="style" defaultValue="chat" className="lg:w-56">
              <option value="chat">{t("styleChat")}</option>
              <option value="voice">{t("styleVoice")}</option>
              <option value="call">{t("styleCall")}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="callerPhone">{t("callerId")}</Label>
            <Input
              id="callerPhone"
              name="callerPhone"
              placeholder="07700 900123"
              className="tabular lg:w-44"
            />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
            <Button type="submit" disabled={busy}>
              {conversationId ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
              {conversationId ? t("restart") : t("start")}
            </Button>
            {conversationId && !ended && !voice ? (
              <Button variant="secondary" onClick={() => void end()} disabled={busy}>
                <Square aria-hidden />
                {t("end")}
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {warning ? <Alert tone="warning">{warning}</Alert> : null}

      {voice ? (
        <div className="space-y-4">
          <VoiceCall key={voice.conversationId} session={voice} onEnded={voiceEnded} />
          {ended ? (
            <Card className="p-5" data-testid="summary">
              <CardHead
                icon={<FileText />}
                title={t("summary")}
                color="var(--color-success)"
                as="h3"
              />
              <p className="mt-3 text-sm" dir="auto">
                {summary?.summary ?? t("summarising")}
              </p>
              {summary ? <SummaryChips summary={summary} /> : null}
            </Card>
          ) : null}
        </div>
      ) : conversationId ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
          <Card className="flex h-[560px] flex-col overflow-hidden p-0">
            <div
              className="flex-1 space-y-3 overflow-y-auto p-4"
              aria-live="polite"
              data-testid="transcript"
            >
              {lines.map((line, i) => (
                <ChatBubble
                  key={i}
                  role={line.role}
                  label={`${line.role === "caller" ? t("you") : t("agent")}:`}
                  meta={
                    line.meta ? (
                      <span className="tabular mt-1.5 flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        <Timer className="size-3" aria-hidden />
                        {line.meta.latencyMs} ms · ${line.meta.costUsd.toFixed(4)}
                      </span>
                    ) : null
                  }
                >
                  {line.text || <TypingDots />}
                </ChatBubble>
              ))}
              <div ref={bottom} />
            </div>
            <form
              onSubmit={(e) => void send(e)}
              className="flex gap-2 border-t border-border bg-[color-mix(in_srgb,var(--color-surface)_50%,transparent)] p-3"
            >
              <Input
                name="text"
                dir="auto"
                className="min-w-0"
                aria-label={t("messageLabel")}
                placeholder={ended ? t("ended") : t("placeholder")}
                disabled={busy || ended}
                autoComplete="off"
              />
              <Button type="submit" disabled={busy || ended}>
                <SendHorizontal aria-hidden className="rtl:-scale-x-100" />
                {t("send")}
              </Button>
            </form>
          </Card>

          <div className="space-y-4">
            <Card className="p-5">
              <CardHead icon={<Cpu />} title={t("engine")} color="var(--color-secondary)" as="h3" />
              <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("flow")}</dt>
                <dd data-testid="flow">
                  {view?.flow ? (
                    <Badge tone="info">
                      <Workflow aria-hidden />
                      {view.flow}
                    </Badge>
                  ) : null}
                </dd>
                <dt className="text-muted-foreground">{t("language")}</dt>
                <dd>
                  {view ? (
                    <Badge tone="secondary">
                      <Languages aria-hidden />
                      {languages(view.language as "en")}
                    </Badge>
                  ) : (
                    ""
                  )}
                </dd>
              </dl>
              {slots && Object.keys(slots).length ? (
                <pre
                  dir="auto"
                  className="mt-4 max-h-48 overflow-auto rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_65%,transparent)] p-3 font-mono text-xs leading-relaxed"
                >
                  {JSON.stringify(slots, null, 2)}
                </pre>
              ) : null}
              {view?.records.length ? (
                <div className="mt-4 flex flex-wrap gap-1.5" data-testid="records">
                  {view.records.map((r) => (
                    <Badge key={r.reference} tone="success">
                      <Star aria-hidden />
                      {t(`record.${r.type}`)} {r.reference}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </Card>
            <Card className="p-5">
              <CardHead
                icon={<Wrench />}
                title={t("toolLog")}
                color="var(--color-accent)"
                as="h3"
                aside={
                  events.length ? (
                    <Badge tone="accent" className="tabular">
                      {events.length}
                    </Badge>
                  ) : null
                }
              />
              <ul className="mt-3 flex max-h-56 flex-wrap content-start gap-1.5 overflow-auto text-xs">
                {events.length === 0 ? <li className="text-muted-foreground">—</li> : null}
                {events.map((e, i) => (
                  <li key={i} className="animate-rise">
                    {e.type === "tool" ? (
                      <Badge tone={e.ok ? "primary" : "danger"} className="font-mono">
                        {e.ok ? <Check aria-hidden /> : <X aria-hidden />}
                        {e.name}
                      </Badge>
                    ) : e.type === "record" ? (
                      <Badge tone="success">
                        <Star aria-hidden />
                        {`${e.record?.type} ${e.record?.reference}`}
                      </Badge>
                    ) : e.type === "language" ? (
                      <Badge tone="secondary">
                        <ArrowLeftRight aria-hidden />
                        {e.language}
                      </Badge>
                    ) : (
                      <Badge tone={e.ok === false ? "danger" : "neutral"}>{e.type}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
            {ended ? (
              <Card className="p-5" data-testid="summary">
                <CardHead
                  icon={<FileText />}
                  title={t("summary")}
                  color="var(--color-success)"
                  as="h3"
                />
                {summary ? (
                  <div className="mt-3 space-y-3 text-sm">
                    <p dir="auto">{summary.summary}</p>
                    <SummaryChips summary={summary} />
                    {summary.actionItems?.length ? (
                      <ul className="space-y-1 text-xs">
                        {summary.actionItems.map((a, i) => (
                          <li key={i} className="flex items-start gap-1.5" dir="auto">
                            <CircleCheck
                              className="mt-px size-3.5 shrink-0 text-primary"
                              aria-hidden
                            />
                            {a}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-muted-foreground">{t("summarising")}</p>
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                )}
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Intent · outcome · sentiment as small chips (same text, joined by dots for readers). */
function SummaryChips(props: { summary: Summary }) {
  const { intent, outcome, sentiment } = props.summary;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Badge tone="info">{intent}</Badge>
      <span aria-hidden>·</span>
      <Badge tone="primary">{outcome}</Badge>
      <span aria-hidden>·</span>
      <Badge tone="accent">{sentiment}</Badge>
    </p>
  );
}
