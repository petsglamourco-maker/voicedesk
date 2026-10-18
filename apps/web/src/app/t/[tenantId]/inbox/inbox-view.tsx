"use client";

import { Alert, Badge, Button, Card, cn, Input } from "@voicedesk/ui";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

type Filter = "all" | "unread" | "needs_human" | "mine";

interface ThreadSummary {
  id: string;
  channel: string;
  name: string | null;
  externalId: string | null;
  subject: string | null;
  mode: "ai" | "human";
  needsHuman: boolean;
  unread: number;
  assignedToMe: boolean;
  lastMessageAt: string;
  lastPreview: string | null;
}

interface ThreadDetail {
  thread: ThreadSummary & { channel: string };
  contact: {
    id: string;
    fullName: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  conversation: {
    id: string;
    status: string;
    summary: { summary?: string } | null;
    records: Array<{ type: string; reference: string }>;
  } | null;
  messages: Array<{
    role: string;
    text: string;
    human: boolean;
    authorName: string | null;
    createdAt: string;
  }>;
}

const CHANNEL_ICON: Record<string, string> = {
  web_chat: "💬",
  whatsapp: "🟢",
  email: "✉️",
  web_form: "📝",
};

/** Unified inbox: every customer thread, live; take over from the assistant and reply. */
export function InboxView(props: {
  tenantId: string;
  selectedId: string | null;
  canReply: boolean;
}) {
  const t = useTranslations("inbox");
  const common = useTranslations("common");
  const format = useFormatter();
  const base = `/api/tenants/${props.tenantId}/inbox`;
  const [filter, setFilter] = useState<Filter>("all");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [counts, setCounts] = useState({ unread: 0, needsHuman: 0 });
  const [selected, setSelected] = useState<string | null>(props.selectedId);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const res = await api<{ threads: ThreadSummary[]; counts: typeof counts }>(
      `${base}?filter=${filter}`,
    );
    setThreads(res.threads);
    setCounts(res.counts);
  }, [base, filter]);

  const loadThread = useCallback(
    async (id: string) => {
      setDetail(await api<ThreadDetail>(`${base}/${id}`));
    },
    [base],
  );

  useEffect(() => {
    let cancelled = false;
    api<{ threads: ThreadSummary[]; counts: typeof counts }>(`${base}?filter=${filter}`)
      .then((res) => {
        if (cancelled) return;
        setThreads(res.threads);
        setCounts(res.counts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base, filter]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api<ThreadDetail>(`${base}/${selected}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base, selected]);

  useEffect(() => {
    void bottom.current?.scrollIntoView({ block: "end" });
  }, [detail]);

  // Live: refresh the list, and the open thread when it changes.
  useEffect(() => {
    const es = new EventSource(`${base}/stream`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data as string) as { threadId: string };
      void loadList();
      if (ev.threadId === selected) void loadThread(ev.threadId);
    };
    return () => es.close();
  }, [base, selected, loadList, loadThread]);

  async function act(path: "takeover" | "handback") {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`${base}/${selected}/${path}`, { method: "POST" });
      await loadThread(selected);
    } finally {
      setBusy(false);
    }
  }

  async function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const text = formString(new FormData(form), "text").trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/${selected}/reply`, { method: "POST", body: JSON.stringify({ text }) });
      form.reset();
      await loadThread(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const label = (th: ThreadSummary) => th.name ?? th.externalId ?? t("visitor");
  const filters: Array<[Filter, string]> = [
    ["all", t("all")],
    ["unread", `${t("unread")}${counts.unread ? ` (${counts.unread})` : ""}`],
    ["needs_human", `${t("needsHuman")}${counts.needsHuman ? ` (${counts.needsHuman})` : ""}`],
    ["mine", t("mine")],
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="flex h-[640px] flex-col p-0">
          <div className="flex flex-wrap gap-1 border-b border-border p-2" role="tablist">
            {filters.map(([f, text]) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium",
                  filter === f ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
              >
                {text}
              </button>
            ))}
          </div>
          <ul className="flex-1 divide-y divide-border overflow-y-auto" data-testid="inbox-threads">
            {threads.length === 0 ? (
              <li className="p-4 text-sm text-muted-foreground">{t("empty")}</li>
            ) : null}
            {threads.map((th) => (
              <li key={th.id}>
                <button
                  onClick={() => setSelected(th.id)}
                  className={cn(
                    "w-full px-3 py-2 text-start hover:bg-muted",
                    selected === th.id && "bg-muted",
                  )}
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span aria-hidden>{CHANNEL_ICON[th.channel] ?? "•"}</span>
                    <span
                      className={cn("flex-1 truncate", th.unread > 0 && "font-semibold")}
                      dir="auto"
                    >
                      {label(th)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {format.relativeTime(new Date(th.lastMessageAt))}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1">
                    <span className="flex-1 truncate text-xs text-muted-foreground" dir="auto">
                      {th.subject ?? th.lastPreview}
                    </span>
                    {th.needsHuman ? (
                      <Badge className="border-warning/40 text-warning">{t("wantsPerson")}</Badge>
                    ) : null}
                    {th.mode === "human" ? <Badge>{t("human")}</Badge> : null}
                    {th.unread > 0 ? (
                      <Badge className="border-primary/40 text-primary">{th.unread}</Badge>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex h-[640px] flex-col p-0">
          {!detail ? (
            <p className="p-6 text-sm text-muted-foreground">{t("pick")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
                <span aria-hidden>{CHANNEL_ICON[detail.thread.channel]}</span>
                <span className="font-medium" dir="auto">
                  {detail.thread.name ?? detail.thread.externalId ?? t("visitor")}
                </span>
                {detail.contact ? (
                  <Link
                    href={`/t/${props.tenantId}/contacts/${detail.contact.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    {t("contact")}
                  </Link>
                ) : null}
                {detail.conversation?.records.map((r) => (
                  <Badge key={r.reference} className="font-mono">
                    {r.reference}
                  </Badge>
                ))}
                <span className="ms-auto flex items-center gap-2">
                  {detail.thread.mode === "human" ? (
                    <>
                      <Badge>{t("youHaveIt")}</Badge>
                      {props.canReply ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void act("handback")}
                        >
                          {t("handBack")}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Badge className="border-success/40 text-success">
                        {t("assistantReplying")}
                      </Badge>
                      {props.canReply ? (
                        <Button size="sm" disabled={busy} onClick={() => void act("takeover")}>
                          {t("takeOver")}
                        </Button>
                      ) : null}
                    </>
                  )}
                </span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4" data-testid="inbox-transcript">
                {detail.messages.map((m, i) => (
                  <div
                    key={i}
                    className={cn("flex", m.role === "caller" ? "justify-start" : "justify-end")}
                  >
                    <div
                      dir="auto"
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                        m.role === "caller"
                          ? "border border-border bg-muted"
                          : m.human
                            ? "bg-primary text-primary-foreground"
                            : "border border-primary/30 bg-primary/5",
                      )}
                    >
                      <span className="mb-0.5 block text-[11px] opacity-70">
                        {m.role === "caller"
                          ? t("customer")
                          : m.human
                            ? (m.authorName ?? t("team"))
                            : t("assistant")}{" "}
                        · {format.dateTime(new Date(m.createdAt), { timeStyle: "short" })}
                      </span>
                      {m.text}
                    </div>
                  </div>
                ))}
                <div ref={bottom} />
              </div>
              {error ? (
                <Alert tone="error" className="mx-4 mb-2">
                  {error}
                </Alert>
              ) : null}
              {props.canReply ? (
                <form
                  onSubmit={(e) => void reply(e)}
                  className="flex gap-2 border-t border-border p-3"
                >
                  <Input
                    name="text"
                    dir="auto"
                    autoComplete="off"
                    aria-label={t("replyLabel")}
                    placeholder={
                      detail.thread.mode === "human" ? t("replyPlaceholder") : t("replyTakesOver")
                    }
                    disabled={busy}
                  />
                  <Button type="submit" disabled={busy}>
                    {t("send")}
                  </Button>
                </form>
              ) : null}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
