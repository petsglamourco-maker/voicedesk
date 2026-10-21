"use client";

import { Alert, Badge, Button, Card, CardDescription, CardTitle, cn, Input } from "@voicedesk/ui";
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
        <Card>
          <CardTitle className="text-base">{t("waiting")}</CardTitle>
          <div className="mt-3 space-y-2">
            {pending.map((a) => (
              <ActionCard key={a.id} base={base} action={a} onChange={updateAction} />
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="flex h-[560px] flex-col p-0">
        <div className="flex-1 space-y-3 overflow-y-auto p-4" data-testid="ask-log">
          {turns.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              <p>{t("intro")}</p>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {examples.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {turns.map((turn, i) => (
            <div
              key={i}
              className={cn("flex flex-col", turn.role === "user" ? "items-end" : "items-start")}
            >
              <div
                dir="auto"
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                  turn.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {turn.text}
              </div>
              {turn.actions?.length ? (
                <div className="mt-2 w-full max-w-[85%] space-y-2">
                  {turn.actions.map((a) => (
                    <ActionCard key={a.id} base={base} action={a} onChange={updateAction} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {busy ? <p className="text-sm text-muted-foreground">{t("thinking")}</p> : null}
          <div ref={bottom} />
        </div>
        {error ? (
          <Alert tone="error" className="mx-4 mb-2">
            {error}
          </Alert>
        ) : null}
        <form onSubmit={(e) => void ask(e)} className="flex gap-2 border-t border-border p-3">
          <Input
            name="question"
            dir="auto"
            autoComplete="off"
            maxLength={2000}
            aria-label={t("placeholder")}
            placeholder={t("placeholder")}
            disabled={busy}
          />
          <Button type="submit" disabled={busy}>
            {t("send")}
          </Button>
        </form>
      </Card>
      <CardDescription>{t("privacy")}</CardDescription>
    </div>
  );
}

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
  return (
    <div
      className="rounded-md border border-dashed border-warning/60 p-3 text-sm"
      data-testid="ask-action"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t(`kind.${action.kind}`)}</Badge>
        <span className="flex-1" dir="auto">
          {action.summary}
        </span>
      </div>
      {editing ? (
        <textarea
          aria-label={t("edit")}
          className="mt-2 h-24 w-full rounded border border-border bg-background p-2 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          dir="auto"
        />
      ) : null}
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      {decided ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t(`status.${action.status}` as "status.done")}
          {action.result ? ` · ${action.result}` : ""}
        </p>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => void decide("approve")}>
            {t("approve")}
          </Button>
          {action.kind === "reply" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(!editing)}>
              {editing ? t("cancelEdit") : t("edit")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide("reject")}>
            {t("reject")}
          </Button>
        </div>
      )}
    </div>
  );
}
