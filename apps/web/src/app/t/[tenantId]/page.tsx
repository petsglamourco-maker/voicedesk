import { Badge, Card, CardDescription, CardTitle, cn } from "@voicedesk/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import {
  BarList,
  Donut,
  Funnel,
  Heatmap,
  LineChart,
  ShareBar,
  Sparkline,
  StackedBars,
  type Series,
} from "@/components/charts";
import { apiGetOrNull, type AuditEntry, type TenantDetail } from "@/lib/api";

export const metadata: Metadata = { title: "Dashboard" };

type View = "daily" | "weekly" | "monthly";
const TOUCHPOINTS = ["voice", "outbound", "web_chat", "whatsapp", "email", "web_form"] as const;
type Touchpoint = (typeof TOUCHPOINTS)[number];

const COLOR: Record<Touchpoint, string> = {
  voice: "var(--color-ch-voice)",
  outbound: "var(--color-ch-outbound)",
  web_chat: "var(--color-ch-web)",
  whatsapp: "var(--color-ch-whatsapp)",
  email: "var(--color-ch-email)",
  web_form: "var(--color-ch-form)",
};

interface Kpi {
  value: number | null;
  previous?: number | null;
}

interface DashboardData {
  view: View;
  timezone: string;
  buckets: string[];
  touchpoints: Record<Touchpoint, number[]>;
  series: {
    conversations: number[];
    bookings: number[];
    tickets: number[];
    messages: number[];
    csat: Array<number | null>;
    latencyMs: Array<number | null>;
  };
  kpis: {
    conversations: Kpi;
    customers: Kpi;
    bookings: Kpi;
    tickets: Kpi;
    messages: Kpi;
    csat: Kpi & { answers: number };
    aiResolved: Kpi;
    latencyMs: Kpi;
    handoffs: { answered: number; missed: number };
    outbound: { placed: number; answered: number };
    unanswered: number;
  };
  channelMix: Record<Touchpoint, number>;
  funnel: { conversations: number; withRecord: number; bookings: number };
  intents: Array<{ intent: string; count: number }>;
  sentiment: Record<string, number>;
  heatmap: number[][];
}

/** Change against the previous period, as a percentage (null when there's nothing to compare). */
function change(kpi: Kpi): number | null {
  if (kpi.value === null || kpi.previous === null || kpi.previous === undefined) return null;
  if (kpi.previous === 0) return kpi.value === 0 ? 0 : null;
  return Math.round(((kpi.value - kpi.previous) / kpi.previous) * 100);
}

function KpiTile(props: {
  label: string;
  value: string;
  delta?: number | null;
  goodWhenUp?: boolean;
  hint?: string;
  trend?: Array<number | null>;
  color?: string;
  vsLabel: string;
}) {
  const up = (props.delta ?? 0) > 0;
  const good = props.goodWhenUp === undefined ? null : up === props.goodWhenUp;
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {props.label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
          {props.value}
        </span>
        {props.delta !== null && props.delta !== undefined && props.delta !== 0 ? (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
              good === null && "bg-muted text-muted-foreground",
              good === true && "bg-success/10 text-success",
              good === false && "bg-danger/10 text-danger",
            )}
            title={props.vsLabel}
          >
            {up ? "▲" : "▼"} {Math.abs(props.delta)}%
          </span>
        ) : null}
      </div>
      {props.hint ? <span className="text-xs text-muted-foreground">{props.hint}</span> : null}
      {props.trend ? (
        <Sparkline
          values={props.trend}
          color={props.color ?? "var(--color-primary)"}
          className="mt-auto"
        />
      ) : null}
    </Card>
  );
}

export default async function TenantDashboard(props: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { tenantId } = await props.params;
  const { view: rawView } = await props.searchParams;
  const view: View = rawView === "weekly" || rawView === "monthly" ? rawView : "daily";
  const detail = await apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`);
  if (!detail) notFound();
  const { tenant, role, permissions } = detail;
  const [data, audit] = await Promise.all([
    permissions.includes("records:read")
      ? apiGetOrNull<DashboardData>(`/api/tenants/${tenantId}/dashboard?view=${view}`)
      : Promise.resolve(null),
    permissions.includes("audit:read")
      ? apiGetOrNull<AuditEntry[]>(`/api/tenants/${tenantId}/audit?limit=10`)
      : Promise.resolve(null),
  ]);

  const t = await getTranslations("dashboard");
  const tt = await getTranslations("tenant");
  const roles = await getTranslations("roles");
  const languages = await getTranslations("languages");
  const onboarding = await getTranslations("onboarding");
  const format = await getFormatter();

  const label = (key: string) => {
    const date = new Date(`${key}T12:00:00Z`);
    if (view === "daily")
      return format.dateTime(date, { weekday: "short", day: "numeric", timeZone: "UTC" });
    if (view === "weekly")
      return format.dateTime(date, { day: "numeric", month: "short", timeZone: "UTC" });
    return format.dateTime(date, { month: "short", year: "2-digit", timeZone: "UTC" });
  };
  const days = Array.from({ length: 7 }, (_, i) =>
    format.dateTime(new Date(Date.UTC(2026, 9, 19 + i, 12)), { weekday: "short", timeZone: "UTC" }),
  );
  const vsLabel = t(`vs.${view}`);

  const rows: Array<[string, string]> = [
    [tt("country"), onboarding(`countries.${tenant.countryCode}` as "countries.GB")],
    [tt("timezone"), tenant.timezone.replaceAll("_", " ")],
    [tt("language"), languages(tenant.defaultLanguage as "en")],
    [tt("dataRegion"), tenant.dataRegion.toUpperCase()],
    [tt("status"), tt(`statuses.${tenant.status}`)],
  ];

  const views: View[] = ["daily", "weekly", "monthly"];
  const labels = data?.buckets.map(label) ?? [];
  const series: Series[] = data
    ? TOUCHPOINTS.map((tp) => ({
        key: tp,
        label: t(`touchpoint.${tp}`),
        color: COLOR[tp],
        values: data.touchpoints[tp],
      }))
    : [];
  const k = data?.kpis;
  const recordsSeries = data
    ? data.series.bookings.map((b, i) => b + data.series.tickets[i]! + data.series.messages[i]!)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            {t("title")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[32px] leading-tight font-semibold tracking-tight sm:text-[36px]">
              {tenant.name}
            </h1>
            <Badge>
              {tt("yourRole")}: {roles(role)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(`range.${view}`)} · {t("timesIn", { tz: tenant.timezone.replaceAll("_", " ") })}
          </p>
        </div>
        <nav
          aria-label={t("period")}
          className="ms-auto flex rounded-lg border border-border bg-surface p-1"
        >
          {views.map((v) => (
            <Link
              key={v}
              href={`?view=${v}`}
              aria-current={v === view ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                v === view
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t(`views.${v}`)}
            </Link>
          ))}
        </nav>
      </div>

      {data && k ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-testid="kpis">
            <KpiTile
              label={t("kpi.conversations")}
              value={String(k.conversations.value ?? 0)}
              delta={change(k.conversations)}
              goodWhenUp
              trend={data.series.conversations}
              hint={vsLabel}
              vsLabel={vsLabel}
            />
            <KpiTile
              label={t("kpi.customers")}
              value={String(k.customers.value ?? 0)}
              delta={change(k.customers)}
              goodWhenUp
              hint={t("kpi.customersHint")}
              vsLabel={vsLabel}
            />
            <KpiTile
              label={t("kpi.bookings")}
              value={String(k.bookings.value ?? 0)}
              delta={change(k.bookings)}
              goodWhenUp
              trend={data.series.bookings}
              color="var(--color-success)"
              vsLabel={vsLabel}
            />
            <KpiTile
              label={t("kpi.csat")}
              value={k.csat.value === null ? "–" : `${k.csat.value}%`}
              delta={change(k.csat)}
              goodWhenUp
              trend={data.series.csat}
              color="var(--color-ch-whatsapp)"
              hint={t("kpi.csatHint", { n: k.csat.answers })}
              vsLabel={vsLabel}
            />
            <KpiTile
              label={t("kpi.aiResolved")}
              value={k.aiResolved.value === null ? "–" : `${k.aiResolved.value}%`}
              hint={t("kpi.aiResolvedHint")}
              vsLabel={vsLabel}
            />
            <KpiTile
              label={t("kpi.latency")}
              value={
                k.latencyMs.value === null ? "–" : `${(k.latencyMs.value / 1000).toFixed(1)} s`
              }
              trend={data.series.latencyMs}
              color="var(--color-ch-outbound)"
              hint={t("kpi.latencyHint")}
              vsLabel={vsLabel}
            />
            <KpiTile
              label={t("kpi.people")}
              value={String(k.handoffs.answered)}
              hint={t("kpi.peopleHint", { missed: k.handoffs.missed })}
              vsLabel={vsLabel}
            />
            <KpiTile
              label={t("kpi.issues")}
              value={String((k.tickets.value ?? 0) + (k.messages.value ?? 0))}
              hint={t("kpi.issuesHint", {
                tickets: k.tickets.value ?? 0,
                messages: k.messages.value ?? 0,
              })}
              trend={recordsSeries}
              color="var(--color-warning)"
              vsLabel={vsLabel}
            />
          </div>

          <Card>
            <div className="flex flex-wrap items-baseline gap-2">
              <CardTitle>{t("engagement")}</CardTitle>
              <CardDescription>{t("engagementHint")}</CardDescription>
            </div>
            <div className="mt-4" data-testid="engagement-chart">
              <StackedBars labels={labels} series={series} emptyText={t("empty")} />
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {TOUCHPOINTS.map((tp) => (
                <li key={tp} className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm" style={{ background: COLOR[tp] }} />
                  {t(`touchpoint.${tp}`)}
                  <span className="font-medium tabular-nums">{data.channelMix[tp]}</span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardTitle className="text-base">{t("mix")}</CardTitle>
              <div className="mt-4">
                <Donut
                  segments={TOUCHPOINTS.map((tp) => ({
                    label: t(`touchpoint.${tp}`),
                    value: data.channelMix[tp],
                    color: COLOR[tp],
                  }))}
                  centerLabel={t("conversations")}
                  emptyText={t("empty")}
                />
              </div>
            </Card>
            <Card>
              <CardTitle className="text-base">{t("funnel")}</CardTitle>
              <CardDescription>{t("funnelHint")}</CardDescription>
              <div className="mt-4">
                <Funnel
                  steps={[
                    { label: t("funnelConversations"), value: data.funnel.conversations },
                    { label: t("funnelRecorded"), value: data.funnel.withRecord },
                    { label: t("funnelBookings"), value: data.funnel.bookings },
                  ]}
                />
              </div>
            </Card>
            <Card>
              <CardTitle className="text-base">{t("mood")}</CardTitle>
              <div className="mt-4">
                <ShareBar
                  parts={[
                    {
                      label: t("sentiment.positive"),
                      value: data.sentiment.positive ?? 0,
                      color: "var(--color-success)",
                    },
                    {
                      label: t("sentiment.neutral"),
                      value: data.sentiment.neutral ?? 0,
                      color: "var(--color-muted-foreground)",
                    },
                    {
                      label: t("sentiment.negative"),
                      value: data.sentiment.negative ?? 0,
                      color: "var(--color-warning)",
                    },
                    {
                      label: t("sentiment.very_negative"),
                      value: data.sentiment.very_negative ?? 0,
                      color: "var(--color-danger)",
                    },
                  ]}
                  emptyText={t("empty")}
                />
              </div>
              <p className="mt-5 text-sm font-medium">{t("wanted")}</p>
              <div className="mt-2">
                <BarList
                  items={data.intents.slice(0, 6).map((i) => ({
                    label: t(`intent.${i.intent}` as "intent.other"),
                    value: i.count,
                  }))}
                  emptyText={t("empty")}
                />
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardTitle className="text-base">{t("when")}</CardTitle>
              <CardDescription>{t("whenHint")}</CardDescription>
              <div className="mt-4">
                <Heatmap grid={data.heatmap} days={days} emptyText={t("empty")} />
              </div>
            </Card>
            <Card>
              <CardTitle className="text-base">{t("more")}</CardTitle>
              <dl className="mt-3 space-y-3 text-sm">
                {[
                  [
                    t("moreOutbound"),
                    `${k.outbound.answered} / ${k.outbound.placed}`,
                    t("moreOutboundHint"),
                  ],
                  [t("moreMissed"), String(k.handoffs.missed), t("moreMissedHint")],
                  [t("moreUnanswered"), String(k.unanswered), t("moreUnansweredHint")],
                ].map(([name, value, hint]) => (
                  <div key={name} className="flex items-start justify-between gap-3">
                    <div>
                      <dt className="font-medium">{name}</dt>
                      <dd className="text-xs text-muted-foreground">{hint}</dd>
                    </div>
                    <dd className="text-xl font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardTitle className="text-base">{t("csatTrend")}</CardTitle>
              <div className="mt-3">
                <LineChart
                  labels={labels}
                  values={data.series.csat}
                  color="var(--color-ch-whatsapp)"
                  unit="%"
                  max={100}
                  emptyText={t("noRatings")}
                />
              </div>
            </Card>
            <Card>
              <CardTitle className="text-base">{t("latencyTrend")}</CardTitle>
              <div className="mt-3">
                <LineChart
                  labels={labels}
                  values={data.series.latencyMs}
                  color="var(--color-ch-outbound)"
                  unit=" s"
                  divide={1000}
                  decimals={1}
                  emptyText={t("noCalls")}
                />
              </div>
            </Card>
            <Card>
              <CardTitle className="text-base">{t("recordsTrend")}</CardTitle>
              <div className="mt-3">
                <StackedBars
                  labels={labels}
                  height={150}
                  width={360}
                  series={[
                    {
                      key: "bookings",
                      label: t("kpi.bookings"),
                      color: "var(--color-success)",
                      values: data.series.bookings,
                    },
                    {
                      key: "tickets",
                      label: t("tickets"),
                      color: "var(--color-danger)",
                      values: data.series.tickets,
                    },
                    {
                      key: "messages",
                      label: t("messages"),
                      color: "var(--color-warning)",
                      values: data.series.messages,
                    },
                  ]}
                  emptyText={t("empty")}
                />
              </div>
            </Card>
          </div>
        </>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>{tt("details")}</CardTitle>
          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map(([name, value]) => (
              <div key={name}>
                <dt className="text-xs tracking-wide text-muted-foreground uppercase">{name}</dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {audit ? (
          <Card>
            <CardTitle>{tt("recentActivity")}</CardTitle>
            {audit.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">{tt("noActivity")}</p>
            ) : (
              <ul className="mt-4 divide-y divide-border text-sm">
                {audit.map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-4 py-2">
                    <code className="font-mono text-xs">{entry.action}</code>
                    <time dateTime={entry.createdAt} className="text-muted-foreground">
                      {format.dateTime(new Date(entry.createdAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: tenant.timezone,
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
