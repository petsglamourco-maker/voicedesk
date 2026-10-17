"use client";

import { Alert, Badge, Button, Card, CardTitle, cn, Input, Label, Select } from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LOCALES } from "@/i18n/locales";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";
import { postSse } from "@/lib/sse";

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
    try {
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <form onSubmit={(e) => void start(e)} className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="language">{t("startLanguage")}</Label>
            <Select id="language" name="language" defaultValue={defaultLanguage} className="w-48">
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {languages(code)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="style">{t("style")}</Label>
            <Select id="style" name="style" defaultValue="chat" className="w-48">
              <option value="chat">{t("styleChat")}</option>
              <option value="voice">{t("styleVoice")}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="callerPhone">{t("callerId")}</Label>
            <Input
              id="callerPhone"
              name="callerPhone"
              placeholder="07700 900123"
              className="w-44"
            />
          </div>
          <Button type="submit" disabled={busy}>
            {conversationId ? t("restart") : t("start")}
          </Button>
          {conversationId && !ended ? (
            <Button variant="secondary" onClick={() => void end()} disabled={busy}>
              {t("end")}
            </Button>
          ) : null}
        </form>
      </Card>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {warning ? <Alert>{warning}</Alert> : null}

      {conversationId ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card className="flex h-[560px] flex-col p-0">
            <div
              className="flex-1 space-y-3 overflow-y-auto p-4"
              aria-live="polite"
              data-testid="transcript"
            >
              {lines.map((line, i) => (
                <div
                  key={i}
                  className={cn("flex", line.role === "caller" ? "justify-end" : "justify-start")}
                >
                  <div
                    dir="auto"
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                      line.role === "caller"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-muted",
                    )}
                  >
                    <span className="sr-only">
                      {line.role === "caller" ? t("you") : t("agent")}:{" "}
                    </span>
                    {line.text || <span className="text-muted-foreground">…</span>}
                    {line.meta ? (
                      <span className="mt-1 block text-[11px] opacity-70">
                        {line.meta.latencyMs} ms · ${line.meta.costUsd.toFixed(4)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={bottom} />
            </div>
            <form onSubmit={(e) => void send(e)} className="flex gap-2 border-t border-border p-3">
              <Input
                name="text"
                dir="auto"
                aria-label={t("messageLabel")}
                placeholder={ended ? t("ended") : t("placeholder")}
                disabled={busy || ended}
                autoComplete="off"
              />
              <Button type="submit" disabled={busy || ended}>
                {t("send")}
              </Button>
            </form>
          </Card>

          <div className="space-y-4">
            <Card className="p-4">
              <CardTitle className="text-base">{t("engine")}</CardTitle>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">{t("flow")}</dt>
                <dd data-testid="flow">{view?.flow}</dd>
                <dt className="text-muted-foreground">{t("language")}</dt>
                <dd>{view ? languages(view.language as "en") : ""}</dd>
              </dl>
              {slots && Object.keys(slots).length ? (
                <pre
                  dir="auto"
                  className="mt-3 max-h-48 overflow-auto rounded bg-muted p-2 text-xs"
                >
                  {JSON.stringify(slots, null, 2)}
                </pre>
              ) : null}
              {view?.records.length ? (
                <div className="mt-3 space-y-1" data-testid="records">
                  {view.records.map((r) => (
                    <Badge key={r.reference} className="mr-1 border-success/40 text-success">
                      {t(`record.${r.type}`)} {r.reference}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </Card>
            <Card className="p-4">
              <CardTitle className="text-base">{t("toolLog")}</CardTitle>
              <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-xs">
                {events.length === 0 ? <li className="text-muted-foreground">—</li> : null}
                {events.map((e, i) => (
                  <li key={i} className={e.ok === false ? "text-danger" : undefined}>
                    {e.type === "tool"
                      ? `${e.ok ? "✓" : "✗"} ${e.name}`
                      : e.type === "record"
                        ? `★ ${e.record?.type} ${e.record?.reference}`
                        : e.type === "language"
                          ? `↔ ${e.language}`
                          : e.type}
                  </li>
                ))}
              </ul>
            </Card>
            {ended ? (
              <Card className="p-4" data-testid="summary">
                <CardTitle className="text-base">{t("summary")}</CardTitle>
                {summary ? (
                  <div className="mt-2 space-y-2 text-sm">
                    <p>{summary.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {summary.intent} · {summary.outcome} · {summary.sentiment}
                    </p>
                    {summary.actionItems?.length ? (
                      <ul className="list-disc ps-5 text-xs">
                        {summary.actionItems.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">{t("summarising")}</p>
                )}
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
