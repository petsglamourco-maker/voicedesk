import { Badge, Card, CardHead, EmptyState, HeroStat, StatusPill } from "@voicedesk/ui";
import {
  AudioLines,
  FlaskConical,
  Gauge,
  Hash,
  Phone,
  PhoneForwarded,
  PhoneOff,
  Radio,
  Timer,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { AiCalls } from "./ai-calls";
import { formatDuration, latencyStatus, type CallRow } from "./format";
import { ChannelDot } from "@/components/channels";
import { ScreenHero } from "@/components/screen-hero";

export const metadata: Metadata = { title: "Calls" };

interface CallsResponse {
  calls: CallRow[];
  latency: {
    days: number;
    calls: number;
    turns: number;
    medianMs: number | null;
    p90Ms: number | null;
    byCarrier: Array<{
      carrier: string;
      calls: number;
      medianMs: number | null;
      p90Ms: number | null;
    }>;
  };
}

interface NumbersResponse {
  numbers: Array<{
    id: string;
    e164: string;
    label: string | null;
    status: string;
    routed: boolean;
  }>;
}

const ms = (v: number | null) => (v === null ? "—" : `${v} ms`);

export default async function CallsPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [data, numbers, detail] = await Promise.all([
    apiGetOrNull<CallsResponse>(`/api/tenants/${tenantId}/calls`),
    apiGetOrNull<NumbersResponse>(`/api/tenants/${tenantId}/phone-numbers`),
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
  ]);
  if (!data) notFound();
  const t = await getTranslations("calls");
  const shell = await getTranslations("shell");
  const format = await getFormatter();
  const active = numbers?.numbers.filter((n) => n.status === "active") ?? [];
  const median = latencyStatus(data.latency.medianMs);
  const p90 = latencyStatus(data.latency.p90Ms);
  const MedianIcon = median.icon;
  const P90Icon = p90.icon;

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="calls"
        eyebrow={shell("groups.customers")}
        title={t("title")}
        description={t("subtitle")}
      >
        {data.latency.medianMs !== null ? (
          <HeroStat
            icon={<Gauge />}
            label={t("median")}
            value={ms(data.latency.medianMs)}
            color={`var(--color-${median.tone})`}
          />
        ) : null}
        {data.latency.p90Ms !== null ? (
          <HeroStat
            icon={<Timer />}
            label={t("p90")}
            value={ms(data.latency.p90Ms)}
            color={`var(--color-${p90.tone})`}
          />
        ) : null}
        {active[0] ? (
          <HeroStat
            icon={<Phone />}
            label={t("yourNumber")}
            value={<span className="font-mono">{active[0].e164}</span>}
            color="var(--color-ch-voice)"
          />
        ) : null}
      </ScreenHero>

      <AiCalls
        tenantId={tenantId}
        canEdit={detail?.permissions.includes("records:write") ?? false}
      />

      <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHead icon={<Phone />} title={t("yourNumber")} color="var(--color-ch-voice)" />
          {active.length ? (
            <ul className="mt-4 space-y-2">
              {active.map((n) => (
                <li
                  key={n.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-primary/40"
                >
                  <ChannelDot channel="voice" size="sm" />
                  <span className="tabular font-mono text-lg" data-testid="phone-number">
                    {n.e164}
                  </span>
                  {n.label ? (
                    <span className="text-sm text-muted-foreground" dir="auto">
                      {n.label}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t("noNumber")}</p>
          )}
          {active.length ? (
            <details className="group mt-4 rounded-lg border border-border px-3 py-2.5 text-sm">
              <summary className="flex cursor-pointer items-center gap-2 font-medium text-primary">
                <PhoneForwarded className="size-4 shrink-0" aria-hidden />
                {t("forwardTitle")}
              </summary>
              <p className="mt-2 text-muted-foreground">{t("forwardIntro")}</p>
              <ul className="mt-2 space-y-1.5 font-mono text-xs">
                <li className="rounded-md bg-muted px-2 py-1.5">
                  {t("forwardAll", { code: `**21*${active[0]!.e164}#` })}
                </li>
                <li className="rounded-md bg-muted px-2 py-1.5">
                  {t("forwardNoAnswer", { code: `**61*${active[0]!.e164}#` })}
                </li>
                <li className="rounded-md bg-muted px-2 py-1.5">
                  {t("forwardBusy", { code: `**67*${active[0]!.e164}#` })}
                </li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">{t("forwardNote")}</p>
            </details>
          ) : null}
        </Card>

        <Card>
          <CardHead
            icon={<Gauge />}
            title={t("latencyTitle", { days: data.latency.days })}
            color="var(--color-info)"
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-border px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">{t("median")}</dt>
              <dd className="mt-1.5">
                <Badge
                  data-testid="latency-median"
                  tone={median.tone}
                  className="tabular px-3 py-1 text-sm"
                >
                  <MedianIcon aria-hidden />
                  {ms(data.latency.medianMs)}
                </Badge>
              </dd>
            </div>
            <div className="rounded-lg border border-border px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">{t("p90")}</dt>
              <dd className="mt-1.5">
                <Badge tone={p90.tone} className="tabular px-3 py-1 text-sm">
                  <P90Icon aria-hidden />
                  {ms(data.latency.p90Ms)}
                </Badge>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("latencyHint", { calls: data.latency.calls, turns: data.latency.turns })}
          </p>
          {data.latency.byCarrier.length > 0 ? (
            <div className="mt-4 border-t border-border pt-3" data-testid="latency-by-carrier">
              <p className="text-xs text-muted-foreground">{t("carrierCompare")}</p>
              <ul className="mt-2 space-y-2 text-sm">
                {data.latency.byCarrier.map((c) => {
                  const s = latencyStatus(c.medianMs);
                  const Icon = s.icon;
                  return (
                    <li
                      key={c.carrier}
                      className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 transition-colors hover:border-primary/40"
                    >
                      <span className="w-16 font-medium capitalize">{c.carrier}</span>
                      <Badge tone={s.tone} className="tabular">
                        <Icon aria-hidden />
                        {ms(c.medianMs)}
                      </Badge>
                      <span className="tabular ms-auto text-xs text-muted-foreground">
                        {t("carrierCalls", { count: c.calls })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        {data.calls.length === 0 ? (
          <EmptyState icon={PhoneOff} title={t("empty")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="calls">
              <thead className="border-b border-border bg-[color-mix(in_srgb,var(--color-muted)_50%,transparent)] text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold">{t("colWhen")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("colCaller")}</th>
                  <th className="px-4 py-3 text-start font-semibold">{t("colOutcome")}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t("colDuration")}</th>
                  <th className="px-4 py-3 text-end font-semibold">{t("colLatency")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.calls.map((c) => {
                  const s = latencyStatus(c.medianLatencyMs);
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-muted/50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="flex items-center gap-2.5">
                          <ChannelDot
                            channel={c.direction === "outbound" ? "outbound" : "voice"}
                            size="sm"
                          />
                          <Link
                            href={`/t/${tenantId}/calls/${c.id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {format.dateTime(new Date(c.startedAt), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </Link>
                          {c.test ? (
                            <StatusPill tone="accent" icon={FlaskConical} label={t("test")} />
                          ) : null}
                          {c.direction === "outbound" ? (
                            <Badge tone="secondary">{t("outbound")}</Badge>
                          ) : null}
                          {c.carrier ? <Badge className="capitalize">{c.carrier}</Badge> : null}
                          {c.status === "active" ? (
                            <StatusPill tone="success" icon={Radio} live label={t("live")} />
                          ) : null}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 whitespace-nowrap">
                        {c.callerPhone ?? (c.callerWithheld ? t("withheld") : "—")}
                      </td>
                      <td className="min-w-64 px-4 py-3" dir="auto">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span>{c.outcome ?? c.flow}</span>
                          {c.records.map((r) => (
                            <Badge key={r.reference} tone="secondary" className="font-mono">
                              <Hash aria-hidden />
                              {r.reference}
                            </Badge>
                          ))}
                          {c.hasRecording ? (
                            <span
                              role="img"
                              aria-label={t("recorded")}
                              title={t("recorded")}
                              className="inline-flex size-6 items-center justify-center rounded-full bg-accent/14 text-accent"
                            >
                              <AudioLines className="size-3" aria-hidden />
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="tabular px-4 py-3 text-end">
                        {formatDuration(c.durationSeconds)}
                      </td>
                      <td className="px-4 py-3 text-end">
                        {c.medianLatencyMs === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <Badge tone={s.tone} className="tabular">
                            {`${c.medianLatencyMs} ms`}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
