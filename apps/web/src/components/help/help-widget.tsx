"use client";

import { Button, Celebrate, cn, Textarea } from "@voicedesk/ui";
import {
  BookOpen,
  LifeBuoy,
  MessageCircleQuestion,
  RotateCcw,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";
import { postSse } from "@/lib/sse";
import { HelpMarkdown } from "./markdown";

/** Opens the Help panel from anywhere (e.g. the command palette). */
export const HELP_OPEN_EVENT = "voicedesk:help";

interface Turn {
  role: "user" | "assistant";
  text: string;
  sources?: Array<{ title: string; page: string | null }>;
  offerSupport?: boolean;
  mode?: "ai" | "articles";
  rating?: "up" | "down";
}

type View = "chat" | "contact" | "sent";

const storageKey = (tenantId: string | undefined) => `vd-help:${tenantId ?? "none"}`;

function loadTurns(tenantId: string | undefined): Turn[] {
  try {
    const raw = sessionStorage.getItem(storageKey(tenantId));
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

function saveTurns(tenantId: string | undefined, turns: Turn[]) {
  try {
    sessionStorage.setItem(storageKey(tenantId), JSON.stringify(turns.slice(-30)));
  } catch {
    // private mode or full storage: the chat just won't survive a page change
  }
}

/**
 * VoiceDesk Help (ADR 0021): the floating help assistant on every signed-in screen. Answers
 * come from the help articles (and yes/no facts about the business); "Contact support" sends
 * the question to the VoiceDesk team.
 */
export function HelpWidget(props: { tenantId?: string }) {
  const t = useTranslations("help");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [includeChat, setIncludeChat] = useState(false);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = streaming !== null;

  const show = useCallback(() => {
    if (!loaded) {
      setTurns(loadTurns(props.tenantId));
      setLoaded(true);
    }
    setOpen(true);
  }, [loaded, props.tenantId]);

  // "?" opens Help (when not typing); Esc closes; the command palette sends an event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if (e.key === "?" && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        show();
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    const onOpen = () => show();
    window.addEventListener("keydown", onKey);
    window.addEventListener(HELP_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(HELP_OPEN_EVENT, onOpen);
    };
  }, [open, show]);

  // Starter questions for the screen the person is on.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ page: string | null; suggestions: string[] }>(
      `/api/help/suggestions?page=${encodeURIComponent(pathname)}`,
    )
      .then((res) => {
        if (cancelled) return;
        setSuggestions(res.suggestions);
        setPageTitle(res.page);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, pathname]);

  useEffect(() => {
    if (open) void bottom.current?.scrollIntoView({ block: "end" });
  }, [open, turns, streaming]);

  function update(next: Turn[]) {
    setTurns(next);
    saveTurns(props.tenantId, next);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    const history = turns.map((x) => ({ role: x.role, text: x.text.slice(0, 4000) }));
    const withQuestion: Turn[] = [...turns, { role: "user", text: q }];
    update(withQuestion);
    setStreaming("");
    try {
      await postSse(
        "/api/help/ask",
        { question: q, history, tenantId: props.tenantId, page: pathname },
        (event, data) => {
          if (event === "delta") {
            setStreaming((s) => (s ?? "") + (data as { text: string }).text);
          } else if (event === "done") {
            const d = data as Omit<Turn, "role" | "text"> & { answer: string };
            update([
              ...withQuestion,
              {
                role: "assistant",
                text: d.answer,
                sources: d.sources,
                offerSupport: d.offerSupport,
                mode: d.mode,
              },
            ]);
          } else if (event === "error") {
            setError((data as { message: string }).message);
          }
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setStreaming(null);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = input.current?.value ?? "";
    if (input.current) input.current.value = "";
    void ask(value);
  }

  function rate(index: number, rating: "up" | "down") {
    update(turns.map((x, i) => (i === index ? { ...x, rating } : x)));
  }

  async function sendSupport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const message = formString(new FormData(e.currentTarget), "message").trim();
    if (message.length < 5) return;
    setSending(true);
    setError(null);
    try {
      await api("/api/help/support", {
        method: "POST",
        body: JSON.stringify({
          message,
          page: pathname,
          tenantId: props.tenantId,
          ...(includeChat && turns.length
            ? { chat: turns.slice(-30).map((x) => ({ role: x.role, text: x.text.slice(0, 4000) })) }
            : {}),
        }),
      });
      setView("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setSending(false);
    }
  }

  const lastQuestion = [...turns].reverse().find((x) => x.role === "user")?.text ?? "";

  return (
    <>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : show())}
        aria-label={open ? t("close") : t("open")}
        aria-expanded={open}
        aria-controls="voicedesk-help"
        data-testid="help-button"
        className={cn(
          "group fixed end-5 bottom-5 z-40 flex size-14 items-center justify-center rounded-full text-primary-foreground transition-transform duration-300 ease-[var(--ease-spring)] hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:end-6 sm:bottom-6",
          open && "max-sm:hidden",
        )}
      >
        <span
          aria-hidden
          className="absolute inset-0 animate-glow-pulse rounded-full bg-[linear-gradient(135deg,var(--color-primary),var(--color-secondary)_60%,var(--color-accent))] opacity-60 blur-md"
        />
        <span
          aria-hidden
          className="relative flex size-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-primary),var(--color-secondary)_60%,var(--color-accent))] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.35),0_10px_30px_-8px_var(--color-glow)]"
        >
          {open ? <X className="size-6" /> : <MessageCircleQuestion className="size-6" />}
        </span>
      </button>

      {open ? (
        <section
          id="voicedesk-help"
          role="dialog"
          aria-label={t("title")}
          data-testid="help-panel"
          className="aurora-border fixed inset-x-0 top-14 bottom-0 z-40 border border-border bg-[color-mix(in_srgb,var(--color-surface)_96%,transparent)] backdrop-blur-xl flex animate-rise flex-col overflow-hidden rounded-t-xl shadow-[0_24px_80px_-20px_rgb(0_0_0/0.55)] sm:inset-x-auto sm:top-auto sm:end-6 sm:bottom-24 sm:h-[min(640px,calc(100vh-8rem))] sm:w-[400px] sm:rounded-xl"
        >
          <header className="relative flex items-center gap-3 border-b border-border px-4 py-3">
            <div aria-hidden className="spotlight pointer-events-none absolute inset-0" />
            <span
              aria-hidden
              className="relative flex size-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,var(--color-primary),var(--color-accent))] text-primary-foreground"
            >
              <Sparkles className="size-4" />
            </span>
            <div className="relative min-w-0 flex-1">
              <h2 className="font-display text-base font-semibold">{t("title")}</h2>
              <p className="truncate text-xs text-muted-foreground">
                {pageTitle ? t("helpingWith", { page: pageTitle }) : t("subtitle")}
              </p>
            </div>
            {view === "chat" && turns.length ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("newChat")}
                onClick={() => update([])}
                disabled={busy}
                className="relative"
              >
                <RotateCcw />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("close")}
              onClick={() => setOpen(false)}
              className="relative"
            >
              <X />
            </Button>
          </header>

          {view === "chat" ? (
            <>
              <div className="flex-1 space-y-4 overflow-y-auto p-4" data-testid="help-log">
                {turns.length === 0 ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">{t("intro")}</p>
                    {suggestions.length ? (
                      <div>
                        <p className="mb-2 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                          {t("tryAsking")}
                        </p>
                        <ul className="space-y-2" data-testid="help-suggestions">
                          {suggestions.map((s) => (
                            <li key={s}>
                              <button
                                type="button"
                                onClick={() => void ask(s)}
                                className="w-full rounded-lg border border-border px-3 py-2 text-start text-sm transition-colors hover:border-primary/50 hover:bg-primary/8"
                                dir="auto"
                              >
                                {s}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {turns.map((turn, i) =>
                  turn.role === "user" ? (
                    <div key={i} className="flex justify-end">
                      <p
                        dir="auto"
                        className="max-w-[85%] rounded-2xl rounded-ee-md bg-[linear-gradient(135deg,var(--color-primary),color-mix(in_srgb,var(--color-primary)_70%,var(--color-secondary)))] px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
                      >
                        {turn.text}
                      </p>
                    </div>
                  ) : (
                    <div key={i} className="space-y-2">
                      <div className="rounded-2xl rounded-es-md border border-border bg-surface px-3.5 py-3">
                        {turn.mode === "articles" ? (
                          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <BookOpen className="size-3.5" aria-hidden />
                            {t("articlesMode")}
                          </p>
                        ) : null}
                        <HelpMarkdown text={turn.text} />
                      </div>
                      {turn.sources?.some((s) => s.page) ? (
                        <div className="flex flex-wrap gap-1.5">
                          {turn.sources
                            .filter((s) => s.page && !s.page.includes(":tenant"))
                            .map((s) => (
                              <Link
                                key={s.title}
                                href={s.page!}
                                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:border-primary/50 hover:text-primary"
                              >
                                <BookOpen className="size-3" aria-hidden />
                                {s.title}
                              </Link>
                            ))}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1">
                        {turn.rating ? (
                          <span className="text-xs text-muted-foreground">{t("thanks")}</span>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("helpful")}
                              onClick={() => rate(i, "up")}
                            >
                              <ThumbsUp />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("notHelpful")}
                              onClick={() => rate(i, "down")}
                            >
                              <ThumbsDown />
                            </Button>
                          </>
                        )}
                        {turn.offerSupport || turn.rating === "down" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            shape="pill"
                            className="ms-auto"
                            onClick={() => setView("contact")}
                          >
                            <LifeBuoy />
                            {t("contact")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ),
                )}

                {streaming !== null ? (
                  <div
                    className="rounded-2xl rounded-es-md border border-border bg-surface px-3.5 py-3"
                    role="status"
                  >
                    {streaming ? (
                      <HelpMarkdown
                        text={streaming.replaceAll(
                          "/t/:tenant",
                          props.tenantId ? `/t/${props.tenantId}` : "/t/:tenant",
                        )}
                      />
                    ) : (
                      <span className="flex items-center gap-1" aria-label={t("thinking")}>
                        {[0, 1, 2].map((d) => (
                          <span
                            key={d}
                            aria-hidden
                            className="size-1.5 animate-glow-pulse rounded-full bg-accent"
                            style={{ animationDelay: `${d * 200}ms` }}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                ) : null}
                {error ? (
                  <p
                    className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}
                <div ref={bottom} />
              </div>

              <form onSubmit={submit} className="space-y-2 border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <Textarea
                    ref={input}
                    name="question"
                    rows={1}
                    maxLength={2000}
                    dir="auto"
                    aria-label={t("placeholder")}
                    placeholder={t("placeholder")}
                    disabled={busy}
                    className="max-h-32 min-h-11 resize-none rounded-2xl"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <Button
                    type="submit"
                    size="icon"
                    shape="pill"
                    disabled={busy}
                    aria-label={t("send")}
                  >
                    <Send />
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>{t("privacy")}</span>
                  <button
                    type="button"
                    onClick={() => setView("contact")}
                    className="shrink-0 font-semibold text-primary hover:underline"
                  >
                    {t("contact")}
                  </button>
                </div>
              </form>
            </>
          ) : view === "contact" ? (
            <form
              onSubmit={(e) => void sendSupport(e)}
              className="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
            >
              <div className="flex items-center gap-2">
                <LifeBuoy className="size-5 text-accent" aria-hidden />
                <h3 className="font-display text-base font-semibold">{t("contactTitle")}</h3>
              </div>
              <p className="text-sm text-muted-foreground">{t("contactHint")}</p>
              <label className="text-sm font-medium" htmlFor="help-support-message">
                {t("messageLabel")}
              </label>
              <Textarea
                id="help-support-message"
                name="message"
                required
                minLength={5}
                maxLength={4000}
                defaultValue={lastQuestion}
                dir="auto"
                className="min-h-32"
              />
              {turns.length ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeChat}
                    onChange={(e) => setIncludeChat(e.target.checked)}
                  />
                  {t("includeChat")}
                </label>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("privacy")}</p>
              {error ? (
                <p
                  className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <div className="mt-auto flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setView("chat")}>
                  {t("cancel")}
                </Button>
                <Button type="submit" disabled={sending}>
                  <Send />
                  {t("sendRequest")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="relative flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="relative flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
                <Celebrate show />
                <LifeBuoy className="size-6" aria-hidden />
              </span>
              <p className="font-display text-base font-semibold" role="status">
                {t("sent")}
              </p>
              <Button variant="secondary" onClick={() => setView("chat")}>
                {t("backToChat")}
              </Button>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
