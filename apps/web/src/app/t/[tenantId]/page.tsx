import { Badge, Card, CardDescription, CardTitle, KpiCard, NumberTicker, cn } from "@voicedesk/ui";
import {
  Activity,
  BadgeCheck,
  BookOpen,
  Bot,
  Building2,
  CalendarCheck2,
  CalendarClock,
  ClipboardList,
  Clock3,
  Flame,
  Gauge,
  Globe2,
  Headset,
  HeartHandshake,
  Languages,
  Layers3,
  Mail,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Phone,
  PhoneOutgoing,
  ShieldCheck,
  Smile,
  Sparkles,
  Ticket,
  Timer,
  TrendingUp,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";
import {
  AreaChart,
  BarList,
  Donut,
  Funnel,
  Heatmap,
  LineChart,
  RadialGauge,
  ShareBar,
  Sparkline,
  StackedBars,
  type Series,
} from "@/components/charts";
import { WhatsAppIcon } from "@/components/shell/icons";
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

const TOUCHPOINT_ICON: Record<Touchpoint, LucideIcon | typeof WhatsAppIcon> = {
  voice: Phone,
  outbound: PhoneOutgoing,
  web_chat: MessageCircle,
  whatsapp: WhatsAppIcon,
  email: Mail,
  web_form: ClipboardList,
};

/** Icon and colour for each audit area in the activity timeline. */
const ACTIVITY_STYLE: Record<string, [LucideIcon, string]> = {
  handoff: [Headset, "var(--color-success)"],
  answerer: [Headset, "var(--color-secondary)"],
  conversation: [MessagesSquare, "var(--color-warning)"],
  booking: [CalendarClock, "var(--color-danger)"],
  ai_call: [PhoneOutgoing, "var(--color-ch-outbound)"],
  call: [PhoneOutgoing, "var(--color-ch-outbound)"],
  contact: [Users, "var(--color-info)"],
  contacts: [Users, "var(--color-info)"],
  member: [UserPlus, "var(--color-secondary)"],
  knowledge: [BookOpen, "var(--color-primary)"],
  profile: [BadgeCheck, "var(--color-primary)"],
  integration: [CalendarCheck2, "var(--color-info)"],
  email: [Mail, "var(--color-ch-email)"],
  mailbox: [Mail, "var(--color-ch-email)"],
  forms: [ClipboardList, "var(--color-ch-form)"],
  widget: [MessageCircle, "var(--color-ch-web)"],
  agent: [Bot, "var(--color-accent)"],
  auth: [ShieldCheck, "var(--color-muted-foreground)"],
  platform: [ShieldCheck, "var(--color-muted-foreground)"],
  va: [Headset, "var(--color-secondary)"],
  tenant: [Building2, "var(--color-primary)"],
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

/** Trend chip input: hidden when there's nothing to compare or no change. */
function trendOf(kpi: Kpi, label: string, goodWhen: "up" | "down" = "up") {
  const delta = change(kpi);
  return delta === null || delta === 0 ? null : { delta, label, goodWhen };
}

/** Staggered entrance for bento tiles (instant with reduced motion). */
const rise = (i: number): CSSProperties => ({ animationDelay: `${i * 60}ms` });

/** ADR 0028: what the assistant did this month (GET /value-report). */
interface ValueNumbers {
  conversations: number;
  calls: number;
  chats: number;
  outOfHours: number | null;
  missedSaved: number;
  assistantBookings: number;
  messages: number;
  callMinutes: number;
  estimatedValuePence: number | null;
}

function CardHead(props: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  color?: string;
  aside?: ReactNode;
}) {
  const Icon = props.icon;
  const color = props.color ?? "var(--color-primary)";
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-xl"
        style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
      >
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <CardTitle className="text-base">{props.title}</CardTitle>
        {props.hint ? <CardDescription className="mt-0.5">{props.hint}</CardDescription> : null}
      </div>
      {props.aside}
    </div>
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
  const [data, audit, value] = await Promise.all([
    permissions.includes("records:read")
      ? apiGetOrNull<DashboardData>(`/api/tenants/${tenantId}/dashboard?view=${view}`)
      : Promise.resolve(null),
    permissions.includes("audit:read")
      ? apiGetOrNull<AuditEntry[]>(`/api/tenants/${tenantId}/audit?limit=10`)
      : Promise.resolve(null),
    permissions.includes("records:read")
      ? apiGetOrNull<{ numbers: ValueNumbers }>(
          `/api/tenants/${tenantId}/value-report?period=this_month`,
        )
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
  const timezone = tenant.timezone.replaceAll("_", " ");

  const details: Array<[LucideIcon, string, string]> = [
    [MapPin, tt("country"), onboarding(`countries.${tenant.countryCode}` as "countries.GB")],
    [Globe2, tt("timezone"), timezone],
    [Languages, tt("language"), languages(tenant.defaultLanguage as "en")],
    [ShieldCheck, tt("dataRegion"), tenant.dataRegion.toUpperCase()],
    [Activity, tt("status"), tt(`statuses.${tenant.status}`)],
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
  const mixTotal = data ? TOUCHPOINTS.reduce((sum, tp) => sum + data.channelMix[tp], 0) : 0;
  const now = new Date();
  const heroDelta = k ? change(k.conversations) : null;
  const busiest = data?.heatmap.reduce<{ day: number; hour: number; n: number } | null>(
    (best, row, day) => row.reduce((b, n, hour) => (n > (b?.n ?? 0) ? { day, hour, n } : b), best),
    null,
  );

  const activityLabel = (action: string) =>
    t.has(`activity.${action}`)
      ? t(`activity.${action}` as "activity.tenant.created")
      : action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0">
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            {t("title")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[32px] leading-tight font-semibold tracking-tight sm:text-[40px]">
              {tenant.name}
            </h1>
            <Badge tone="primary">
              {tt("yourRole")}: {roles(role)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(`range.${view}`)} · {t("timesIn", { tz: timezone })}
          </p>
        </div>
        <nav aria-label={t("period")} className="glass ms-auto flex rounded-full p-1">
          {views.map((v) => (
            <Link
              key={v}
              href={`?view=${v}`}
              aria-current={v === view ? "page" : undefined}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-[background-color,color,box-shadow] duration-300",
                v === view
                  ? "bg-primary text-primary-foreground shadow-[0_0_18px_0_var(--color-glow)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`views.${v}`)}
            </Link>
          ))}
        </nav>
      </header>

      {data && k ? (
        <>
          <section
            className="grid [&>*]:min-w-0 grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-12"
            data-testid="kpis"
          >
            {/* Hero: the period at a glance. */}
            <div
              className="glass aurora-border relative col-span-2 animate-rise overflow-hidden rounded-xl p-5 sm:p-7 lg:col-span-8"
              style={rise(0)}
            >
              <div aria-hidden className="spotlight pointer-events-none absolute inset-0" />
              <div aria-hidden className="dot-grid pointer-events-none absolute inset-0" />
              <div className="relative">
                <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <MessagesSquare className="size-4 text-primary" aria-hidden />
                      {t("kpi.conversations")}
                    </p>
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <NumberTicker
                        value={k.conversations.value ?? 0}
                        className="text-aurora font-display text-[56px] leading-[0.9] font-semibold tracking-tight sm:text-[72px]"
                      />
                      {heroDelta ? (
                        <span
                          className={cn(
                            "tabular mb-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                            heroDelta > 0
                              ? "bg-success/12 text-success"
                              : "bg-danger/12 text-danger",
                          )}
                        >
                          <TrendingUp
                            className={cn("size-3.5", heroDelta < 0 && "-scale-y-100")}
                            aria-hidden
                          />
                          {`${heroDelta > 0 ? "+" : "−"}${Math.abs(heroDelta)}%`}
                          <span className="font-medium text-muted-foreground">{vsLabel}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                    <CalendarClock className="size-3.5" aria-hidden />
                    {t(`range.${view}`)}
                  </span>
                </div>
                <div className="mt-4" data-testid="conversations-chart">
                  <AreaChart
                    className="hidden sm:block"
                    labels={labels}
                    values={data.series.conversations}
                    unit={` ${t("conversations")}`}
                    emptyText={t("empty")}
                  />
                  <AreaChart
                    className="sm:hidden"
                    width={360}
                    height={200}
                    labels={labels}
                    values={data.series.conversations}
                    unit={` ${t("conversations")}`}
                    emptyText={t("empty")}
                  />
                </div>
                <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TOUCHPOINTS.map((tp) => {
                    const Icon = TOUCHPOINT_ICON[tp];
                    const n = data.channelMix[tp];
                    const share = mixTotal ? Math.round((n / mixTotal) * 100) : 0;
                    return (
                      <li
                        key={tp}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 transition-colors",
                          n ? "bg-[color-mix(in_srgb,var(--orb)_8%,transparent)]" : "opacity-60",
                        )}
                        style={{ ["--orb" as string]: COLOR[tp] }}
                      >
                        <span
                          aria-hidden
                          className="flex size-7 shrink-0 items-center justify-center rounded-full"
                          style={{
                            color: COLOR[tp],
                            background: `color-mix(in srgb, ${COLOR[tp]} 16%, transparent)`,
                            boxShadow: n ? `0 0 14px -2px ${COLOR[tp]}` : undefined,
                          }}
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-muted-foreground">
                            {t(`touchpoint.${tp}`)}
                          </span>
                          <span className="tabular font-display text-base font-semibold">{n}</span>
                          {n ? (
                            <span className="ms-1.5 text-[11px] text-muted-foreground">
                              {t("ofAll", { n: share })}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* The assistant's share, the team and voice speed. */}
            <Card className="col-span-2 flex animate-rise flex-col lg:col-span-4" style={rise(1)}>
              <CardHead
                icon={Sparkles}
                title={t("kpi.aiResolved")}
                hint={t("assistantHint")}
                color="var(--color-accent)"
              />
              <RadialGauge
                value={k.aiResolved.value}
                label={t("kpi.aiResolved")}
                className="my-5"
              />
              <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-4">
                <div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Headset className="size-3.5 text-success" aria-hidden />
                    {t("team")}
                  </p>
                  <p className="tabular mt-1 font-display text-2xl font-semibold">
                    {k.handoffs.answered}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("teamHint", { answered: k.handoffs.answered, missed: k.handoffs.missed })}
                  </p>
                </div>
                <div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Timer className="size-3.5 text-[var(--color-ch-outbound)]" aria-hidden />
                    {t("latencyShort")}
                  </p>
                  <p className="tabular mt-1 font-display text-2xl font-semibold">
                    {k.latencyMs.value === null
                      ? "–"
                      : `${(k.latencyMs.value / 1000).toFixed(1)} s`}
                  </p>
                  <Sparkline
                    values={data.series.latencyMs}
                    color="var(--color-ch-outbound)"
                    className="h-6"
                  />
                </div>
              </div>
            </Card>

            <KpiCard
              className="animate-rise lg:col-span-3"
              style={rise(2)}
              label={t("kpi.customers")}
              value={k.customers.value ?? 0}
              icon={<Users />}
              color="var(--color-secondary)"
              trend={trendOf(k.customers, vsLabel)}
              hint={t("kpi.customersHint")}
            />
            <KpiCard
              className="animate-rise lg:col-span-3"
              style={rise(3)}
              label={t("kpi.bookings")}
              value={k.bookings.value ?? 0}
              icon={<CalendarCheck2 />}
              color="var(--color-success)"
              trend={trendOf(k.bookings, vsLabel)}
              chart={<Sparkline values={data.series.bookings} color="var(--color-success)" />}
            />
            <KpiCard
              className="animate-rise lg:col-span-3"
              style={rise(4)}
              label={t("kpi.csat")}
              value={k.csat.value}
              suffix="%"
              icon={<Smile />}
              color="var(--color-ch-whatsapp)"
              trend={trendOf(k.csat, vsLabel)}
              hint={t("kpi.csatHint", { n: k.csat.answers })}
              chart={<Sparkline values={data.series.csat} color="var(--color-ch-whatsapp)" />}
            />
            <KpiCard
              className="animate-rise lg:col-span-3"
              style={rise(5)}
              label={t("kpi.issues")}
              value={(k.tickets.value ?? 0) + (k.messages.value ?? 0)}
              icon={<Ticket />}
              color="var(--color-warning)"
              hint={t("kpi.issuesHint", {
                tickets: k.tickets.value ?? 0,
                messages: k.messages.value ?? 0,
              })}
              chart={<Sparkline values={recordsSeries} color="var(--color-warning)" />}
            />
          </section>

          {value ? (
            <Card className="animate-rise" style={rise(6)} data-testid="value-card">
              <CardHead
                icon={TrendingUp}
                title={t("value.title")}
                hint={t("value.hint")}
                color="var(--color-success)"
              />
              <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {[
                  {
                    label: t("value.conversations"),
                    value: String(value.numbers.conversations),
                    hint: t("value.conversationsHint", {
                      calls: value.numbers.calls,
                      chats: value.numbers.chats,
                    }),
                  },
                  {
                    label: t("value.outOfHours"),
                    value:
                      value.numbers.outOfHours === null ? "–" : String(value.numbers.outOfHours),
                    hint:
                      value.numbers.outOfHours === null
                        ? t("value.outOfHoursUnknown")
                        : t("value.missedSaved", { n: value.numbers.missedSaved }),
                  },
                  {
                    label: t("value.bookings"),
                    value: String(value.numbers.assistantBookings),
                    hint: t("value.bookingsHint"),
                  },
                  {
                    label: t("value.messages"),
                    value: String(value.numbers.messages),
                    hint: t("value.minutes", { n: value.numbers.callMinutes }),
                  },
                  {
                    label: t("value.worth"),
                    value:
                      value.numbers.estimatedValuePence === null
                        ? "–"
                        : format.number(value.numbers.estimatedValuePence / 100, {
                            style: "currency",
                            currency: "GBP",
                            maximumFractionDigits: 0,
                          }),
                    hint:
                      value.numbers.estimatedValuePence === null
                        ? t("value.setAverage")
                        : t("value.worthHint"),
                  },
                ].map((item) => (
                  <div key={item.label} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{item.label}</dt>
                    <dd className="tabular mt-1 font-display text-2xl font-semibold">
                      {item.value}
                    </dd>
                    <dd className="text-[11px] text-muted-foreground">{item.hint}</dd>
                  </div>
                ))}
              </dl>
              {value.numbers.estimatedValuePence === null ? (
                <Link
                  href={`/t/${tenantId}/agent`}
                  className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
                >
                  {t("value.setAverageLink")}
                </Link>
              ) : null}
            </Card>
          ) : null}

          <section className="grid [&>*]:min-w-0 gap-4 lg:grid-cols-12">
            <Card className="animate-rise lg:col-span-8" style={rise(6)}>
              <CardHead icon={Layers3} title={t("engagement")} hint={t("engagementHint")} />
              <div className="mt-5" data-testid="engagement-chart">
                <StackedBars labels={labels} series={series} emptyText={t("empty")} />
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                {TOUCHPOINTS.map((tp) => (
                  <li key={tp} className="flex items-center gap-2">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: COLOR[tp], boxShadow: `0 0 8px ${COLOR[tp]}` }}
                    />
                    {t(`touchpoint.${tp}`)}
                    <span className="tabular font-semibold">{data.channelMix[tp]}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="animate-rise lg:col-span-4" style={rise(7)}>
              <CardHead icon={Gauge} title={t("mix")} color="var(--color-secondary)" />
              <div className="mt-5">
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
          </section>

          <section className="grid [&>*]:min-w-0 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card className="animate-rise" style={rise(8)}>
              <CardHead
                icon={TrendingUp}
                title={t("funnel")}
                hint={t("funnelHint")}
                color="var(--color-success)"
              />
              <div className="mt-5">
                <Funnel
                  steps={[
                    { label: t("funnelConversations"), value: data.funnel.conversations },
                    { label: t("funnelRecorded"), value: data.funnel.withRecord },
                    { label: t("funnelBookings"), value: data.funnel.bookings },
                  ]}
                />
              </div>
            </Card>
            <Card className="animate-rise" style={rise(9)}>
              <CardHead icon={HeartHandshake} title={t("mood")} color="var(--color-accent)" />
              <div className="mt-5">
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
              <p className="mt-5 text-sm font-semibold">{t("wanted")}</p>
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
            <Card className="animate-rise md:col-span-2 lg:col-span-1" style={rise(10)}>
              <CardHead icon={Flame} title={t("more")} color="var(--color-warning)" />
              <dl className="mt-4 space-y-2">
                {(
                  [
                    [
                      PhoneOutgoing,
                      "var(--color-ch-outbound)",
                      t("moreOutbound"),
                      `${k.outbound.answered} / ${k.outbound.placed}`,
                      t("moreOutboundHint"),
                    ],
                    [
                      Headset,
                      "var(--color-danger)",
                      t("moreMissed"),
                      String(k.handoffs.missed),
                      t("moreMissedHint"),
                    ],
                    [
                      BookOpen,
                      "var(--color-info)",
                      t("moreUnanswered"),
                      String(k.unanswered),
                      t("moreUnansweredHint"),
                    ],
                  ] as const
                ).map(([Icon, color, name, value, hint]) => (
                  <div
                    key={name}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                  >
                    <Icon className="size-4 shrink-0" style={{ color }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <dt className="text-sm font-medium">{name}</dt>
                      <dd className="text-xs text-muted-foreground">{hint}</dd>
                    </div>
                    <dd className="tabular font-display text-xl font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </section>

          <section className="grid [&>*]:min-w-0 gap-4 lg:grid-cols-12">
            <Card className="animate-rise lg:col-span-8" style={rise(11)}>
              <CardHead
                icon={Clock3}
                title={t("when")}
                hint={t("whenHint")}
                color="var(--color-info)"
              />
              <div className="mt-5">
                <Heatmap grid={data.heatmap} days={days} emptyText={t("empty")} />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-4 text-sm">
                {busiest ? (
                  <p className="flex items-center gap-2">
                    <Flame className="size-4 text-warning" aria-hidden />
                    {t("busiest", {
                      day: days[busiest.day]!,
                      hour: format.dateTime(new Date(Date.UTC(2026, 0, 1, busiest.hour)), {
                        hour: "numeric",
                        timeZone: "UTC",
                      }),
                    })}
                  </p>
                ) : null}
                <div className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  {t("fewer")}
                  {[0.15, 0.4, 0.65, 1].map((o) => (
                    <span
                      key={o}
                      aria-hidden
                      className="size-3 rounded-[3px] bg-primary"
                      style={{ opacity: o }}
                    />
                  ))}
                  {t("moreLegend")}
                </div>
              </div>
            </Card>
            <div className="grid [&>*]:min-w-0 gap-4 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-1">
              <Card className="animate-rise" style={rise(12)}>
                <CardHead icon={Smile} title={t("csatTrend")} color="var(--color-ch-whatsapp)" />
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
              <Card className="animate-rise" style={rise(13)}>
                <CardHead icon={Timer} title={t("latencyTrend")} color="var(--color-ch-outbound)" />
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
            </div>
          </section>
        </>
      ) : null}

      <section className="grid [&>*]:min-w-0 gap-4 lg:grid-cols-12">
        {data ? (
          <Card className="animate-rise lg:col-span-5" style={rise(14)}>
            <CardHead icon={Ticket} title={t("recordsTrend")} color="var(--color-success)" />
            <div className="mt-4">
              <StackedBars
                labels={labels}
                height={300}
                width={420}
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
        ) : null}

        {audit ? (
          <Card
            className={cn("animate-rise", data ? "lg:col-span-7" : "lg:col-span-12")}
            style={rise(15)}
          >
            <CardHead icon={Activity} title={tt("recentActivity")} />
            {audit.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">{t("noActivity")}</p>
            ) : (
              <ol className="relative mt-5 space-y-4 before:absolute before:top-2 before:bottom-2 before:start-[15px] before:w-px before:bg-[linear-gradient(to_bottom,var(--color-primary),var(--color-secondary),transparent)]">
                {audit.map((entry, i) => {
                  const [Icon, color] = ACTIVITY_STYLE[entry.action.split(".")[0]!] ?? [
                    Activity,
                    "var(--color-muted-foreground)",
                  ];
                  const at = new Date(entry.createdAt);
                  return (
                    <li key={entry.id} className="relative flex items-center gap-3">
                      <span
                        aria-hidden
                        className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface"
                        style={{
                          color,
                          boxShadow: i === 0 ? `0 0 16px -2px ${color}` : undefined,
                        }}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {activityLabel(entry.action)}
                      </span>
                      <time
                        dateTime={entry.createdAt}
                        title={format.dateTime(at, {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: tenant.timezone,
                        })}
                        className="shrink-0 text-xs text-muted-foreground"
                      >
                        {format.relativeTime(at, now)}
                      </time>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        ) : null}
      </section>

      <Card variant="ghost" className="animate-rise p-4" style={rise(16)}>
        <dl aria-label={tt("details")} className="flex flex-wrap items-center gap-x-8 gap-y-3">
          {details.map(([Icon, name, value]) => (
            <div key={name} className="flex items-center gap-2.5">
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              <div>
                <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
                  {name}
                </dt>
                <dd className="text-sm font-medium">{value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
