"use client";

import { Alert, Button, cn } from "@voicedesk/ui";
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
    return <p className="mt-4 text-sm">{t("answered")}</p>;
  }

  return (
    <div className="mt-5 space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("title")}>
        {scale.map((n) => (
          <button
            key={n}
            type="button"
            disabled={score !== null}
            onClick={() => void rate(n)}
            className={cn(
              "h-11 min-w-11 rounded-md border border-border px-3 text-base font-medium hover:bg-muted disabled:cursor-default",
              score === n && "bg-primary text-primary-foreground hover:bg-primary",
            )}
            data-testid={`rate-${n}`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{props.kind === "nps" ? t("unlikely") : t("poor")}</span>
        <span>{props.kind === "nps" ? t("likely") : t("excellent")}</span>
      </div>
      {score !== null ? (
        <div className="space-y-3">
          <Alert tone="success">{t("thanks", { business: props.businessName })}</Alert>
          {sentComment ? null : (
            <div>
              <label htmlFor="comment" className="text-sm font-medium">
                {t("commentLabel")}
              </label>
              <textarea
                id="comment"
                dir="auto"
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="mt-1 h-24 w-full rounded-md border border-border bg-background p-2 text-sm"
              />
              <Button className="mt-2" size="sm" onClick={() => void sendComment()}>
                {t("sendComment")}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
