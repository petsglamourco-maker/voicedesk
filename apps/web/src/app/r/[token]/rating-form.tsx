"use client";

import { Alert, Button, Celebrate, Label, Textarea, cn } from "@voicedesk/ui";
import { CheckCircle2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client-api";

export function RatingForm(props: {
  token: string;
  kind: "csat" | "nps";
  answered: boolean;
  businessName: string;
}) {
  const t = useTranslations("ratePage");
  const common = useTranslations("common");
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [sentComment, setSentComment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/public/feedback/${encodeURIComponent(props.token)}`;
  const scale = props.kind === "nps" ? Array.from({ length: 11 }, (_, i) => i) : [1, 2, 3, 4, 5];

  async function rate(value: number) {
    setError(null);
    try {
      await api(url, { method: "POST", body: JSON.stringify({ score: value }) });
      setScore(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    }
  }

  async function sendComment() {
    if (!comment.trim()) return;
    try {
      await api(url, { method: "POST", body: JSON.stringify({ comment }) });
      setSentComment(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    }
  }

  if (props.answered && score === null) {
    return (
      <p className="mt-5 flex items-center gap-2 text-[15px]">
        <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
        <span>{t("answered")}</span>
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-5">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <div
          className={cn(
            "grid gap-2 sm:gap-2.5",
            props.kind === "nps" ? "grid-cols-6 sm:grid-cols-11" : "grid-cols-5",
          )}
          role="group"
          aria-label={t("title")}
        >
          {scale.map((n) => (
            <Button
              key={n}
              variant={score === n ? "primary" : "secondary"}
              disabled={score !== null}
              onClick={() => void rate(n)}
              className={cn(
                "tabular w-full min-w-0 rounded-xl px-0 font-display font-semibold disabled:cursor-default",
                props.kind === "nps" ? "h-12 text-base" : "h-14 text-xl sm:h-16",
                score === null &&
                  "hover:-translate-y-0.5 hover:border-primary/60 hover:text-primary hover:shadow-[0_0_22px_-4px_var(--color-glow)]",
                score === n &&
                  "scale-105 shadow-[0_0_28px_2px_var(--color-glow)] ring-2 ring-primary/50 ring-offset-2 ring-offset-background disabled:opacity-100",
              )}
              data-testid={`rate-${n}`}
            >
              {n}
            </Button>
          ))}
        </div>
        <div className="mt-2.5 flex justify-between gap-4 text-xs text-muted-foreground">
          <span>{props.kind === "nps" ? t("unlikely") : t("poor")}</span>
          <span className="text-end">{props.kind === "nps" ? t("likely") : t("excellent")}</span>
        </div>
      </div>
      {score !== null ? (
        <div className="space-y-5">
          <div
            role="status"
            className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 p-4"
          >
            <span
              aria-hidden
              className="relative flex size-10 shrink-0 items-center justify-center"
            >
              <span className="relative flex size-10 items-center justify-center rounded-full bg-success/18 text-success shadow-[0_0_22px_-4px_var(--color-success)]">
                <CheckCircle2 className="size-5" />
              </span>
              <Celebrate show />
            </span>
            <p className="min-w-0 text-[15px]">{t("thanks", { business: props.businessName })}</p>
          </div>
          {sentComment ? null : (
            <div>
              <Label htmlFor="comment">{t("commentLabel")}</Label>
              <Textarea
                id="comment"
                dir="auto"
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <Button className="mt-3" onClick={() => void sendComment()}>
                <Send aria-hidden />
                {t("sendComment")}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
