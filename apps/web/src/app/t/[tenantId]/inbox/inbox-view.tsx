"use client";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  cn,
  EmptyState,
  HeroStat,
  Input,
  Kbd,
  StatusPill,
  Textarea,
} from "@voicedesk/ui";
import {
  ArrowLeft,
  Bot,
  Hand,
  Headset,
  Inbox as InboxIcon,
  Keyboard,
  MailOpen,
  MessagesSquare,
  PenLine,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";
import { ChannelDot } from "@/components/channels";
import { ScreenHero } from "@/components/screen-hero";

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
  /** ADR 0025 */
  department?: string | null;
}

interface ThreadDetail {
  thread: ThreadSummary & { channel: string; canEmailReply?: boolean };
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
    /** An assistant email reply waiting for approval. */
    draft?: boolean;
    discarded?: boolean;
    authorName: string | null;
    createdAt: string;
  }>;
}

/** Unified inbox: every customer thread, live; take over from the assistant and reply. */
export function InboxView(props: {
  tenantId: string;
  selectedId: string | null;
  canReply: boolean;
}) {
  const t = useTranslations("inbox");
  const shell = useTranslations("shell");
  const channels = useTranslations("dashboard.touchpoint");
  const common = useTranslations("common");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const base = `/api/tenants/${props.tenantId}/inbox`;
  const [filter, setFilter] = useState<Filter>("all");
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [counts, setCounts] = useState({ unread: 0, needsHuman: 0 });
  const [selected, setSelected] = useState<string | null>(props.selectedId);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The draft being edited before sending. */
  const [draftEdit, setDraftEdit] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const replyInput = useRef<HTMLInputElement>(null);

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

  async function sendDraft(text: string) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/${selected}/send-draft`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setDraftEdit(null);
      await loadThread(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  // Keyboard (desktop): J / K move between threads, R jumps to the reply box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (target &&
          (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
      )
        return;
      const key = e.key.toLowerCase();
      if (key === "j" || key === "k") {
        if (threads.length === 0) return;
        const at = threads.findIndex((th) => th.id === selected);
        const next =
          at === -1 ? 0 : Math.min(threads.length - 1, Math.max(0, at + (key === "j" ? 1 : -1)));
        setSelected(threads[next]!.id);
        e.preventDefault();
      } else if (key === "r" && replyInput.current) {
        replyInput.current.focus();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [threads, selected]);

  const label = (th: ThreadSummary) => th.name ?? th.externalId ?? t("visitor");
  const channelName = (c: string) => (channels.has(c) ? channels(c as "voice") : c);
  const filters: Array<[Filter, string, number]> = [
    ["all", t("all"), 0],
    ["unread", t("unread"), counts.unread],
    ["needs_human", t("needsHuman"), counts.needsHuman],
    ["mine", t("mine"), 0],
  ];

  return (
    <div className="stagger space-y-4">
      <ScreenHero
        icon="inbox"
        eyebrow={shell("groups.overview")}
        title={t("title")}
        description={t("subtitle")}
      >
        <HeroStat
          icon={<MailOpen />}
          label={t("unread")}
          value={counts.unread}
          color="var(--color-primary)"
        />
        <HeroStat
          icon={<Hand />}
          label={t("needsHuman")}
          value={counts.needsHuman}
          color="var(--color-warning)"
        />
      </ScreenHero>
      <div className="grid gap-4 lg:grid-cols-[360px_1fr] [&>*]:min-w-0">
        {/* Phones show the list, then the conversation full width (ADR 0024). */}
        <Card
          className={cn(
            "flex max-h-[calc(100dvh-14rem)] flex-col overflow-hidden p-0 lg:flex lg:h-[680px] lg:max-h-none",
            selected && "max-lg:hidden",
          )}
        >
          <div className="border-b border-border p-2">
            <div className="flex gap-1 rounded-full bg-muted/60 p-1" role="tablist">
              {filters.map(([f, text, n]) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-200",
                    filter === f
                      ? "bg-primary text-primary-foreground shadow-[0_0_14px_0_var(--color-glow)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {text}
                  {n ? (
                    <span
                      className={cn(
                        "tabular rounded-full px-1.5 text-[10px]",
                        filter === f ? "bg-primary-foreground/20" : "bg-primary/15 text-primary",
                      )}
                    >
                      {n}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          <ul className="flex-1 space-y-1 overflow-y-auto p-2" data-testid="inbox-threads">
            {threads.length === 0 ? (
              <li>
                <EmptyState icon={InboxIcon} title={t("empty")} className="py-16" />
              </li>
            ) : null}
            {threads.map((th) => {
              const active = selected === th.id;
              return (
                <li key={th.id}>
                  <button
                    onClick={() => setSelected(th.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "relative flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-start transition-[background-color,border-color,box-shadow] duration-200",
                      active
                        ? "border-primary/40 bg-primary/10 shadow-[0_0_24px_-10px_var(--color-glow)]"
                        : "border-transparent hover:border-border hover:bg-muted/60",
                      th.needsHuman && !active && "border-warning/30",
                    )}
                  >
                    {active ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-primary shadow-[0_0_8px_var(--color-primary)]"
                      />
                    ) : null}
                    <span className="relative shrink-0">
                      <Avatar name={label(th)} />
                      <ChannelDot
                        channel={th.channel}
                        size="sm"
                        glow={false}
                        className="absolute -end-1.5 -bottom-1.5 size-5 border-2 border-surface [&_svg]:size-2.5"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm">
                        <span
                          className={cn("flex-1 truncate", th.unread > 0 && "font-semibold")}
                          dir="auto"
                        >
                          {label(th)}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {format.relativeTime(new Date(th.lastMessageAt), now)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-xs",
                          th.unread > 0 ? "text-foreground/80" : "text-muted-foreground",
                        )}
                        dir="auto"
                      >
                        {th.subject ?? th.lastPreview}
                      </span>
                      {th.needsHuman || th.mode === "human" || th.unread > 0 || th.department ? (
                        <span className="mt-1.5 flex flex-wrap items-center gap-1">
                          {th.department ? <Badge tone="primary">{th.department}</Badge> : null}
                          {th.needsHuman ? (
                            <StatusPill tone="warning" icon={Hand} label={t("wantsPerson")} live />
                          ) : null}
                          {th.mode === "human" ? (
                            <StatusPill tone="secondary" icon={Headset} label={t("human")} />
                          ) : null}
                          {th.unread > 0 ? (
                            <span className="tabular ms-auto flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground shadow-[0_0_10px_0_var(--color-glow)]">
                              {th.unread}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="hidden items-center gap-1.5 border-t border-border px-3 py-2 text-[11px] text-muted-foreground lg:flex">
            <Keyboard className="size-3.5" aria-hidden />
            <Kbd>J</Kbd>
            <Kbd>K</Kbd>
            {t("shortcutMove")}
            <span className="mx-1">·</span>
            <Kbd>R</Kbd>
            {t("shortcutReply")}
          </p>
        </Card>

        <Card
          className={cn(
            "flex h-[calc(100dvh-12rem)] min-h-[420px] flex-col overflow-hidden p-0 lg:flex lg:h-[680px]",
            !selected && "max-lg:hidden",
          )}
        >
          {!detail ? (
            <EmptyState
              icon={MessagesSquare}
              title={t("pick")}
              className="m-auto"
              description={
                <span className="hidden items-center gap-1.5 lg:inline-flex">
                  <Kbd>J</Kbd>
                  <Kbd>K</Kbd>
                  {t("shortcutMove")}
                </span>
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="lg:hidden"
                  aria-label={t("backToList")}
                  onClick={() => {
                    setSelected(null);
                    setDetail(null);
                  }}
                >
                  <ArrowLeft className="rtl:rotate-180" />
                </Button>
                <span className="relative shrink-0">
                  <Avatar
                    name={detail.thread.name ?? detail.thread.externalId ?? t("visitor")}
                    size="lg"
                  />
                  <ChannelDot
                    channel={detail.thread.channel}
                    size="sm"
                    className="absolute -end-1 -bottom-1 border-2 border-surface"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-base font-semibold" dir="auto">
                    {detail.thread.name ?? detail.thread.externalId ?? t("visitor")}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{channelName(detail.thread.channel)}</span>
                    {detail.contact ? (
                      <Link
                        href={`/t/${props.tenantId}/contacts/${detail.contact.id}`}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        <UserRound className="size-3" aria-hidden />
                        {t("contact")}
                      </Link>
                    ) : null}
                    {detail.conversation?.records.map((r) => (
                      <Badge key={r.reference} tone="secondary" className="font-mono">
                        {r.reference}
                      </Badge>
                    ))}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  {detail.thread.mode === "human" ? (
                    <>
                      <StatusPill tone="secondary" icon={Headset} label={t("youHaveIt")} />
                      {props.canReply ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void act("handback")}
                        >
                          <Bot aria-hidden />
                          {t("handBack")}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <StatusPill tone="success" icon={Bot} label={t("assistantReplying")} live />
                      {props.canReply ? (
                        <Button size="sm" disabled={busy} onClick={() => void act("takeover")}>
                          <Hand aria-hidden />
                          {t("takeOver")}
                        </Button>
                      ) : null}
                    </>
                  )}
                </span>
              </div>
              <div
                className="flex-1 space-y-3 overflow-y-auto bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--color-primary)_6%,transparent),transparent_60%)] p-4"
                data-testid="inbox-transcript"
              >
                {detail.messages.map((m, i) => {
                  const customer = m.role === "caller";
                  const who = customer
                    ? t("customer")
                    : m.human
                      ? (m.authorName ?? t("team"))
                      : t("assistant");
                  return (
                    <div
                      key={i}
                      className={cn(
                        "flex items-end gap-2",
                        customer ? "justify-start" : "justify-end",
                      )}
                    >
                      {customer ? (
                        <Avatar
                          name={detail.thread.name ?? detail.thread.externalId ?? t("visitor")}
                          size="sm"
                        />
                      ) : null}
                      <div
                        dir="auto"
                        className={cn(
                          "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
                          customer
                            ? "rounded-es-md border border-border bg-surface"
                            : m.human
                              ? "rounded-ee-md bg-[linear-gradient(135deg,var(--color-primary),color-mix(in_srgb,var(--color-primary)_75%,var(--color-secondary)))] text-primary-foreground shadow-[0_6px_24px_-10px_var(--color-glow)]"
                              : m.draft
                                ? "rounded-ee-md border border-dashed border-warning/60 bg-warning/8"
                                : "rounded-ee-md border border-primary/30 bg-primary/8",
                          m.discarded && "opacity-50",
                        )}
                        data-testid={m.draft ? "inbox-draft" : undefined}
                      >
                        <span className="mb-1 flex items-center gap-1.5 text-[11px] opacity-75">
                          {!customer && !m.human ? (
                            <Sparkles className="size-3" aria-hidden />
                          ) : m.draft ? (
                            <PenLine className="size-3" aria-hidden />
                          ) : null}
                          {who} · {format.dateTime(new Date(m.createdAt), { timeStyle: "short" })}
                          {m.draft
                            ? ` · ${t("draft")}`
                            : m.discarded
                              ? ` · ${t("discarded")}`
                              : null}
                        </span>
                        {m.draft && draftEdit !== null ? (
                          <Textarea
                            aria-label={t("editDraft")}
                            className="h-40 w-full min-w-[280px]"
                            value={draftEdit}
                            onChange={(e) => setDraftEdit(e.target.value)}
                          />
                        ) : (
                          m.text
                        )}
                        {m.draft && !detail.thread.canEmailReply ? (
                          <span className="mt-2 block text-xs text-muted-foreground">
                            {t("noEmail")}
                          </span>
                        ) : null}
                        {m.draft && props.canReply && detail.thread.canEmailReply ? (
                          <span className="mt-2 flex gap-2">
                            <Button
                              size="sm"
                              disabled={busy || draftEdit?.trim() === ""}
                              onClick={() => void sendDraft(draftEdit ?? m.text)}
                            >
                              <Send aria-hidden />
                              {t("approveSend")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setDraftEdit(draftEdit === null ? m.text : null)}
                            >
                              {draftEdit === null ? t("editDraft") : t("cancelEdit")}
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>
              {error ? (
                <Alert tone="error" className="mx-4 mb-2">
                  {error}
                </Alert>
              ) : null}
              {props.canReply ? (
                <form
                  method="post"
                  onSubmit={(e) => void reply(e)}
                  className="flex items-center gap-2 border-t border-border p-3"
                >
                  <Input
                    ref={replyInput}
                    name="text"
                    dir="auto"
                    autoComplete="off"
                    aria-label={t("replyLabel")}
                    placeholder={
                      detail.thread.mode === "human" ? t("replyPlaceholder") : t("replyTakesOver")
                    }
                    disabled={busy}
                    className="h-11 rounded-full px-4"
                  />
                  <Button type="submit" disabled={busy} shape="pill" className="h-11 px-5">
                    <Send aria-hidden />
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
