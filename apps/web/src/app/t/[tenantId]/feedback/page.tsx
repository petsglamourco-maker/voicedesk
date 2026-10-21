import { Card, CardHead, EmptyState, HeroStat, KpiCard, StatusPill, cn } from "@voicedesk/ui";
import { Bot, Gauge, Headset, MessageSquareQuote, Smile, Star, ThumbsUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChannelDot, channelMeta } from "@/components/channels";
import { ScreenHero } from "@/components/screen-hero";
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

const HANDLER_ICON: Record<string, typeof Bot> = { ai: Bot, human: Headset };

/** A score bar: share of satisfied answers, coloured by how good it is. */
function ScoreBar(props: { value: number | null }) {
  const v = props.value ?? 0;
  const color =
    props.value === null
      ? "var(--color-muted)"
      : v >= 80
        ? "var(--color-success)"
        : v >= 50
          ? "var(--color-warning)"
          : "var(--color-danger)";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-[var(--ease-spring)]"
        style={{ width: `${v}%`, background: color, boxShadow: `0 0 10px ${color}` }}
      />
    </div>
  );
}

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
  const shell = await getTranslations("shell");
  const channels = await getTranslations("dashboard.touchpoint");
  const format = await getFormatter();
  const now = new Date();
  const o = data.overall;
  const pct = (v: number | null) => (v === null ? t("noData") : `${v}%`);
  const channelName = (c: string) =>
    channels.has(c) ? channels(c as "voice") : c.replaceAll("_", " ");
  const responseRate = o.sent ? Math.round((o.answered / o.sent) * 100) : null;

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="feedback"
        eyebrow={shell("groups.customers")}
        title={t("title")}
        description={t("subtitle")}
        actions={
          <nav aria-label={t("title")} className="glass flex rounded-full p-1">
            {[7, 30, 90].map((d) => (
              <Link
                key={d}
                href={`?days=${d}`}
                aria-current={data.days === d ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors",
                  data.days === d
                    ? "bg-primary text-primary-foreground shadow-[0_0_18px_0_var(--color-glow)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("days", { days: d })}
              </Link>
            ))}
          </nav>
        }
      >
        {responseRate !== null ? (
          <HeroStat
            icon={<Gauge />}
            label={t("responseRate")}
            value={`${responseRate}%`}
            color="var(--color-accent)"
          />
        ) : null}
      </ScreenHero>

      <div className="grid gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <KpiCard
          hero
          label={t("csat")}
          value={o.csat}
          placeholder={t("noData")}
          suffix="%"
          icon={<Smile />}
          color="var(--color-success)"
          hint={o.csatAverage === null ? t("csatHint") : t("average", { avg: o.csatAverage })}
        />
        <KpiCard
          label={t("nps")}
          value={o.nps}
          placeholder={t("noData")}
          icon={<ThumbsUp />}
          color="var(--color-secondary)"
          hint={t("npsHint", { n: o.npsAnswers })}
        />
        <KpiCard
          label={t("responses")}
          value={o.answered}
          icon={<MessageSquareQuote />}
          color="var(--color-accent)"
          hint={t("responsesHint", { answered: o.answered, sent: o.sent })}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHead icon={<Gauge />} title={t("byChannel")} color="var(--color-secondary)" />
          <ul className="mt-4 space-y-3 text-sm">
            {data.byChannel.map((c) => (
              <li key={c.channel} className="flex items-center gap-3">
                <ChannelDot channel={c.channel} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{channelName(c.channel)}</span>
                    <span className="tabular">
                      {pct(c.csat)}
                      <span className="ms-2 text-xs text-muted-foreground">{c.answered}</span>
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <ScoreBar value={c.csat} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHead icon={<Headset />} title={t("byHandler")} color="var(--color-accent)" />
          <ul className="mt-4 space-y-3 text-sm">
            {data.byHandler.map((h) => {
              const Icon = HANDLER_ICON[h.handledBy] ?? Star;
              return (
                <li key={h.handledBy} className="flex items-center gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/14 text-accent">
                    <Icon className="size-3" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">
                        {t(`handler.${h.handledBy}` as "handler.ai")}
                      </span>
                      <span className="tabular">
                        {pct(h.csat)}
                        <span className="ms-2 text-xs text-muted-foreground">{h.answered}</span>
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <ScoreBar value={h.csat} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHead icon={<MessageSquareQuote />} title={t("latest")} color="var(--color-primary)" />
        {data.latest.length === 0 ? (
          <EmptyState icon={Star} title={t("empty")} />
        ) : (
          <ul className="mt-4 space-y-2" data-testid="feedback-latest">
            {data.latest.map((f) => {
              const max = f.kind === "nps" ? 10 : 5;
              const low = f.kind === "nps" ? f.score <= 6 : f.score <= 2;
              const high = f.kind === "nps" ? f.score >= 9 : f.score >= 4;
              return (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-[color-mix(in_srgb,var(--c)_45%,transparent)]"
                  style={{ ["--c" as string]: channelMeta(f.channel).color }}
                >
                  <StatusPill
                    tone={low ? "danger" : high ? "success" : "warning"}
                    icon={Star}
                    label={`${f.score}/${max}`}
                  />
                  <ChannelDot channel={f.channel} size="sm" label={channelName(f.channel)} />
                  <span className="font-medium" dir="auto">
                    {f.contactName ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1 text-muted-foreground" dir="auto">
                    {f.comment}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {format.relativeTime(new Date(f.answeredAt), now)}
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
