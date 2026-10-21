"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHead,
  Celebrate,
  cn,
  Input,
  Textarea,
} from "@voicedesk/ui";
import {
  CalendarX2,
  Check,
  CheckCircle2,
  CircleSlash,
  Lock,
  MessageCircleQuestion,
  MessageSquareReply,
  PenLine,
  PhoneCall,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";
import { ScreenHero } from "@/components/screen-hero";

interface Action {
  id: string;
  kind: "reply" | "cancel_booking" | "schedule_callback";
  summary: string;
  payload: Record<string, unknown>;
  status: string;
  result: string | null;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  actions?: Action[];
}

/** "Ask VoiceDesk": questions about the business; proposed actions need an approval click. */
export function AskPanel(props: { tenantId: string }) {
  const t = useTranslations("ask");
  const shell = useTranslations("shell");
  const common = useTranslations("common");
  const base = `/api/tenants/${props.tenantId}/assistant`;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<Action[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ actions: Action[] }>(`${base}/actions`)
      .then((res) => {
        if (!cancelled) setPending(res.actions.filter((a) => a.status === "pending"));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base]);

  useEffect(() => {
    void bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const question = formString(new FormData(form), "question").trim();
    if (!question) return;
    form.reset();
    const history = turns.map((x) => ({ role: x.role, text: x.text }));
    setTurns((list) => [...list, { role: "user", text: question }]);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ answer: string; actions: Action[] }>(`${base}/ask`, {
        method: "POST",
        body: JSON.stringify({ question, history }),
      });
      setTurns((list) => [
        ...list,
        { role: "assistant", text: res.answer || t("noAnswer"), actions: res.actions },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function updateAction(updated: Action) {
    const patch = (a: Action) => (a.id === updated.id ? updated : a);
    setTurns((list) => list.map((x) => ({ ...x, actions: x.actions?.map(patch) })));
    setPending((list) => list.filter((a) => a.id !== updated.id));
  }

  const examples = [t("example1"), t("example2"), t("example3")];

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="ask"
        eyebrow={shell("groups.overview")}
        title={t("title")}
        description={t("subtitle")}
      />

      {pending.length ? (
        <Card className="border-warning/30">
          <CardHead
            icon={<ShieldCheck />}
            title={t("waiting")}
            color="var(--color-warning)"
            aside={<Badge tone="warning">{pending.length}</Badge>}
          />
          <div className="mt-4 space-y-2">
            {pending.map((a) => (
              <ActionCard key={a.id} base={base} action={a} onChange={updateAction} />
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="flex h-[600px] flex-col overflow-hidden p-0">
        <div
          className="flex-1 space-y-4 overflow-y-auto bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--color-accent)_7%,transparent),transparent_60%)] p-4 sm:p-5"
          data-testid="ask-log"
        >
          {turns.length === 0 ? (
            <div className="flex flex-col items-center px-2 py-8 text-center">
              <span aria-hidden className="relative mb-5 flex size-16 items-center justify-center">
                <span className="absolute inset-0 animate-glow-pulse rounded-full bg-[radial-gradient(circle,var(--color-accent),transparent_70%)] opacity-50 blur-xl" />
                <span className="relative flex size-16 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--color-primary),var(--color-secondary)_55%,var(--color-accent))] text-primary-foreground shadow-[0_0_30px_-6px_var(--color-glow)]">
                  <Sparkles className="size-7" />
                </span>
              </span>
              <p className="max-w-md text-[15px] text-muted-foreground">{t("intro")}</p>
              <ul className="mt-5 flex max-w-xl flex-wrap justify-center gap-2">
                {examples.map((e) => (
                  <li
                    key={e}
                    className="glass flex items-center gap-2 rounded-full px-3.5 py-2 text-sm"
                    dir="auto"
                  >
                    <MessageCircleQuestion className="size-4 text-accent" aria-hidden />
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {turns.map((turn, i) => (
            <div
              key={i}
              className={cn("flex gap-2.5", turn.role === "user" ? "flex-row-reverse" : "flex-row")}
            >
              {turn.role === "assistant" ? (
                <span
                  aria-hidden
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-primary),var(--color-accent))] text-primary-foreground shadow-[0_0_16px_-4px_var(--color-glow)]"
                >
                  <Sparkles className="size-4" />
                </span>
              ) : null}
              <div
                className={cn(
                  "flex max-w-[85%] flex-col",
                  turn.role === "user" ? "items-end" : "items-start",
                )}
              >
                <div
                  dir="auto"
                  className={cn(
                    "rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap",
                    turn.role === "user"
                      ? "rounded-ee-md bg-[linear-gradient(135deg,var(--color-primary),color-mix(in_srgb,var(--color-primary)_70%,var(--color-secondary)))] text-primary-foreground shadow-[0_6px_24px_-10px_var(--color-glow)]"
                      : "rounded-es-md border border-border bg-surface",
                  )}
                >
                  {turn.text}
                </div>
                {turn.actions?.length ? (
                  <div className="mt-2 w-full space-y-2">
                    {turn.actions.map((a) => (
                      <ActionCard key={a.id} base={base} action={a} onChange={updateAction} />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {busy ? (
            <div className="flex items-center gap-2.5" role="status">
              <span
                aria-hidden
                className="flex size-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-primary),var(--color-accent))] text-primary-foreground"
              >
                <Sparkles className="size-4" />
              </span>
              <span className="flex items-center gap-1 rounded-2xl rounded-es-md border border-border bg-surface px-3.5 py-3">
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    aria-hidden
                    className="size-1.5 animate-glow-pulse rounded-full bg-accent"
                    style={{ animationDelay: `${d * 200}ms` }}
                  />
                ))}
                <span className="sr-only">{t("thinking")}</span>
              </span>
            </div>
          ) : null}
          <div ref={bottom} />
        </div>
        {error ? (
          <Alert tone="error" className="mx-4 mb-2">
            {error}
          </Alert>
        ) : null}
        <form
          onSubmit={(e) => void ask(e)}
          className="flex items-center gap-2 border-t border-border p-3"
        >
          <Input
            name="question"
            dir="auto"
            autoComplete="off"
            maxLength={2000}
            aria-label={t("placeholder")}
            placeholder={t("placeholder")}
            disabled={busy}
            className="h-11 rounded-full px-4"
          />
          <Button type="submit" disabled={busy} shape="pill" className="h-11 px-5">
            <Send aria-hidden />
            {t("send")}
          </Button>
        </form>
      </Card>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        {t("privacy")}
      </p>
    </div>
  );
}

const KIND_ICON = {
  reply: MessageSquareReply,
  cancel_booking: CalendarX2,
  schedule_callback: PhoneCall,
} as const;

/** A proposed action: nothing happens until someone clicks Approve. */
function ActionCard(props: { base: string; action: Action; onChange: (a: Action) => void }) {
  const t = useTranslations("ask");
  const common = useTranslations("common");
  const { action } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(
    typeof action.payload.text === "string" ? action.payload.text : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(kind: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ status: string; result?: string }>(
        `${props.base}/actions/${action.id}/${kind}`,
        {
          method: "POST",
          body: JSON.stringify(kind === "approve" && editing ? { text } : {}),
        },
      );
      props.onChange({ ...action, status: res.status, result: res.result ?? null });
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const decided = action.status !== "pending";
  const Icon = KIND_ICON[action.kind];
  return (
    <div
      className={cn(
        "relative rounded-xl border p-3.5 text-sm transition-[border-color,box-shadow] duration-300",
        decided
          ? "border-border bg-surface/60"
          : "border-accent/40 bg-accent/6 shadow-[0_0_28px_-12px_var(--color-accent)]",
      )}
      data-testid="ask-action"
    >
      <Celebrate show={action.status === "done"} />
      <div className="flex flex-wrap items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/14 text-accent"
        >
          <Icon className="size-4" />
        </span>
        <Badge tone="accent">{t(`kind.${action.kind}`)}</Badge>
        <span className="min-w-0 flex-1" dir="auto">
          {action.summary}
        </span>
      </div>
      {editing ? (
        <Textarea
          aria-label={t("edit")}
          className="mt-3 h-24"
          value={text}
          onChange={(e) => setText(e.target.value)}
          dir="auto"
        />
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      {decided ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          {action.status === "done" ? (
            <CheckCircle2 className="size-3.5 text-success" aria-hidden />
          ) : (
            <CircleSlash className="size-3.5" aria-hidden />
          )}
          {t(`status.${action.status}` as "status.done")}
          {action.result ? ` · ${action.result}` : ""}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void decide("approve")}>
            <Check aria-hidden />
            {t("approve")}
          </Button>
          {action.kind === "reply" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => setEditing(!editing)}
            >
              <PenLine aria-hidden />
              {editing ? t("cancelEdit") : t("edit")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide("reject")}>
            <X aria-hidden />
            {t("reject")}
          </Button>
        </div>
      )}
    </div>
  );
}
