"use client";

import { Alert, Badge, Button, Card, CardHead, Field, Input, Textarea } from "@voicedesk/ui";
import { CircleCheck, MessageCircleQuestion, Sparkles, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { MicButton } from "@/components/voice/voice-typing";

export interface GapAnswer {
  id: string;
  question: string;
  count: number;
  lastAskedAt: string;
  draft: string | null;
  sources: Array<{ title: string | null; url: string | null }>;
  drafting: boolean;
}

/**
 * Questions the assistant couldn't answer (ADR 0026), grouped, with an answer drafted from
 * your documents. Approve (after any edits) and the assistant knows it from then on.
 */
export function QuestionsToAnswer(props: {
  tenantId: string;
  initial: GapAnswer[];
  canEdit: boolean;
}) {
  const t = useTranslations("questionsToAnswer");
  const common = useTranslations("common");
  const [items, setItems] = useState(props.initial);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.initial.map((q) => [q.id, q.draft ?? ""])),
  );
  const [questions, setQuestions] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.initial.map((q) => [q.id, q.question])),
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function decide(id: string, action: "approve" | "dismiss") {
    setPending(id);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/tenants/${props.tenantId}/gap-answers/${id}/${action}`, {
        method: "POST",
        ...(action === "approve"
          ? { body: JSON.stringify({ question: questions[id], answer: answers[id] }) }
          : {}),
      });
      setItems((list) => list.filter((q) => q.id !== id));
      setNotice(action === "approve" ? t("approved") : t("dismissed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(null);
    }
  }

  return (
    <Card id="questions" data-testid="questions-to-answer">
      <CardHead
        icon={<MessageCircleQuestion />}
        title={t("title")}
        hint={t("hint")}
        color="var(--color-warning)"
        aside={items.length ? <Badge tone="warning">{items.length}</Badge> : undefined}
      />
      {error ? (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" className="mt-4">
          {notice}
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {items.map((q) => (
            <li key={q.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="secondary">{t("asked", { count: q.count })}</Badge>
                {q.draft ? (
                  <Badge tone="primary">
                    <Sparkles aria-hidden />
                    {t("drafted")}
                  </Badge>
                ) : q.drafting ? (
                  <Badge>{t("drafting")}</Badge>
                ) : (
                  <Badge>{t("noDraft")}</Badge>
                )}
              </div>
              <div className="mt-3 space-y-3">
                <Field id={`q-${q.id}`} label={t("question")}>
                  <Input
                    id={`q-${q.id}`}
                    dir="auto"
                    maxLength={300}
                    disabled={!props.canEdit}
                    value={questions[q.id] ?? ""}
                    onChange={(e) => setQuestions((m) => ({ ...m, [q.id]: e.target.value }))}
                  />
                </Field>
                <Field
                  id={`a-${q.id}`}
                  label={t("answer")}
                  hint={
                    q.sources.length
                      ? t("from", {
                          sources: q.sources
                            .map((s) => s.title ?? s.url ?? "")
                            .filter(Boolean)
                            .join(", "),
                        })
                      : t("writeIt")
                  }
                >
                  <AnswerBox
                    id={`a-${q.id}`}
                    disabled={!props.canEdit}
                    value={answers[q.id] ?? ""}
                    onChange={(value) => setAnswers((m) => ({ ...m, [q.id]: value }))}
                  />
                </Field>
              </div>
              {props.canEdit ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    disabled={pending !== null || (answers[q.id] ?? "").trim().length < 2}
                    onClick={() => void decide(q.id, "approve")}
                  >
                    <CircleCheck aria-hidden />
                    {pending === q.id ? common("working") : t("approve")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={pending !== null}
                    onClick={() => void decide(q.id, "dismiss")}
                  >
                    <X aria-hidden />
                    {t("dismiss")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The answer textarea with its own microphone (voice typing, ADR 0027). */
function AnswerBox(props: {
  id: string;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="flex items-start gap-2">
      <Textarea
        ref={box}
        id={props.id}
        dir="auto"
        rows={3}
        maxLength={1000}
        disabled={props.disabled}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.disabled ? null : <MicButton target={box} />}
    </div>
  );
}
