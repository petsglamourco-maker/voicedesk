import { Badge, Card, CardDescription, CardTitle } from "@voicedesk/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { apiGetOrNull } from "@/lib/api";

export const metadata: Metadata = { title: "Feedback" };

interface Stats {
  sent: number;
  answered: number;
  csat: number | null;
  csatAverage: number | null;
  nps: number | null;
  npsAnswers: number;
}

interface FeedbackResponse {
  days: number;
  overall: Stats;
  byChannel: Array<Stats & { channel: string }>;
  byHandler: Array<Stats & { handledBy: string }>;
  latest: Array<{
    id: string;
    conversationId: string;
    channel: string;
    kind: string;
    score: number;
    comment: string | null;
    handledBy: string;
    contactName: string | null;
    answeredAt: string;
  }>;
}

const CHANNEL_ICON: Record<string, string> = {
  web_chat: "💬",
  whatsapp: "🟢",
  email: "✉️",
  web_form: "📝",
  voice: "📞",
};

/** CSAT / NPS dashboard (Phase 6). */
export default async function FeedbackPage(props: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { tenantId } = await props.params;
  const { days = "30" } = await props.searchParams;
  const data = await apiGetOrNull<FeedbackResponse>(
    `/api/tenants/${tenantId}/feedback?days=${encodeURIComponent(days)}`,
  );
  if (!data) notFound();
  const t = await getTranslations("feedback");
  const format = await getFormatter();
  const o = data.overall;
  const pct = (v: number | null) => (v === null ? t("noData") : `${v}%`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="ms-auto flex gap-1 text-sm">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`?days=${d}`}
              className={
                data.days === d
                  ? "rounded-md bg-primary px-2 py-1 text-primary-foreground"
                  : "rounded-md px-2 py-1 hover:bg-muted"
              }
            >
              {t("days", { days: d })}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardDescription>{t("csat")}</CardDescription>
          <p className="mt-1 text-3xl font-semibold" data-testid="csat">
            {pct(o.csat)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {o.csatAverage === null ? t("csatHint") : t("average", { avg: o.csatAverage })}
          </p>
        </Card>
        <Card>
          <CardDescription>{t("nps")}</CardDescription>
          <p className="mt-1 text-3xl font-semibold">{o.nps === null ? t("noData") : o.nps}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("npsHint", { n: o.npsAnswers })}</p>
        </Card>
        <Card>
          <CardDescription>{t("responses")}</CardDescription>
          <p className="mt-1 text-3xl font-semibold">{o.answered}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("responsesHint", { answered: o.answered, sent: o.sent })}
          </p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle className="text-base">{t("byChannel")}</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {data.byChannel.map((c) => (
              <li key={c.channel} className="flex gap-2">
                <span aria-hidden>{CHANNEL_ICON[c.channel] ?? "•"}</span>
                <span className="flex-1">{c.channel}</span>
                <span>{pct(c.csat)}</span>
                <span className="w-20 text-end text-muted-foreground">{c.answered}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle className="text-base">{t("byHandler")}</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {data.byHandler.map((h) => (
              <li key={h.handledBy} className="flex gap-2">
                <span className="flex-1">{t(`handler.${h.handledBy}` as "handler.ai")}</span>
                <span>{pct(h.csat)}</span>
                <span className="w-20 text-end text-muted-foreground">{h.answered}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-0">
        <CardTitle className="px-4 pt-4 text-base">{t("latest")}</CardTitle>
        {data.latest.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border" data-testid="feedback-latest">
            {data.latest.map((f) => {
              const max = f.kind === "nps" ? 10 : 5;
              const low = f.kind === "nps" ? f.score <= 6 : f.score <= 2;
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                  <Badge className={low ? "border-danger/40 text-danger" : undefined}>
                    {f.score}/{max}
                  </Badge>
                  <span aria-hidden>{CHANNEL_ICON[f.channel] ?? "•"}</span>
                  <span className="font-medium" dir="auto">
                    {f.contactName ?? "—"}
                  </span>
                  <span className="flex-1 text-muted-foreground" dir="auto">
                    {f.comment}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format.relativeTime(new Date(f.answeredAt))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
