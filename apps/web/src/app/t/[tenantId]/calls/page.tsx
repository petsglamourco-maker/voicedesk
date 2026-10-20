import { Badge, Card, CardDescription, CardTitle, cn } from "@voicedesk/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { apiGetOrNull } from "@/lib/api";
import { formatDuration, latencyTone, type CallRow } from "./format";

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

export default async function CallsPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [data, numbers] = await Promise.all([
    apiGetOrNull<CallsResponse>(`/api/tenants/${tenantId}/calls`),
    apiGetOrNull<NumbersResponse>(`/api/tenants/${tenantId}/phone-numbers`),
  ]);
  if (!data) notFound();
  const t = await getTranslations("calls");
  const format = await getFormatter();
  const active = numbers?.numbers.filter((n) => n.status === "active") ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle className="text-base">{t("yourNumber")}</CardTitle>
          {active.length ? (
            <ul className="mt-2 space-y-1">
              {active.map((n) => (
                <li key={n.id} className="font-mono text-lg" data-testid="phone-number">
                  {n.e164}
                  {n.label ? (
                    <span className="ms-2 font-sans text-sm text-muted-foreground">{n.label}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <CardDescription className="mt-2">{t("noNumber")}</CardDescription>
          )}
          {active.length ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium text-primary">
                {t("forwardTitle")}
              </summary>
              <p className="mt-2 text-muted-foreground">{t("forwardIntro")}</p>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                <li>{t("forwardAll", { code: `**21*${active[0]!.e164}#` })}</li>
                <li>{t("forwardNoAnswer", { code: `**61*${active[0]!.e164}#` })}</li>
                <li>{t("forwardBusy", { code: `**67*${active[0]!.e164}#` })}</li>
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">{t("forwardNote")}</p>
            </details>
          ) : null}
        </Card>

        <Card>
          <CardTitle className="text-base">
            {t("latencyTitle", { days: data.latency.days })}
          </CardTitle>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("median")}</dt>
              <dd>
                <Badge data-testid="latency-median" className={latencyTone(data.latency.medianMs)}>
                  {data.latency.medianMs === null ? "—" : `${data.latency.medianMs} ms`}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("p90")}</dt>
              <dd>
                <Badge className={latencyTone(data.latency.p90Ms)}>
                  {data.latency.p90Ms === null ? "—" : `${data.latency.p90Ms} ms`}
                </Badge>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("latencyHint", { calls: data.latency.calls, turns: data.latency.turns })}
          </p>
          {data.latency.byCarrier.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3" data-testid="latency-by-carrier">
              <p className="text-xs text-muted-foreground">{t("carrierCompare")}</p>
              <ul className="mt-1 space-y-1 text-sm">
                {data.latency.byCarrier.map((c) => (
                  <li key={c.carrier} className="flex items-center gap-2">
                    <span className="w-16 capitalize">{c.carrier}</span>
                    <Badge className={latencyTone(c.medianMs)}>
                      {c.medianMs === null ? "—" : `${c.medianMs} ms`}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {t("carrierCalls", { count: c.calls })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="p-0">
        {data.calls.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="calls">
              <thead className="border-b border-border text-start text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-start font-normal">{t("colWhen")}</th>
                  <th className="px-4 py-2 text-start font-normal">{t("colCaller")}</th>
                  <th className="px-4 py-2 text-start font-normal">{t("colOutcome")}</th>
                  <th className="px-4 py-2 text-end font-normal">{t("colDuration")}</th>
                  <th className="px-4 py-2 text-end font-normal">{t("colLatency")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.calls.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/50">
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link
                        href={`/t/${tenantId}/calls/${c.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {format.dateTime(new Date(c.startedAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </Link>
                      {c.test ? <Badge className="ms-2">{t("test")}</Badge> : null}
                      {c.direction === "outbound" ? (
                        <Badge className="ms-2">{t("outbound")}</Badge>
                      ) : null}
                      {c.carrier ? <Badge className="ms-2 capitalize">{c.carrier}</Badge> : null}
                      {c.status === "active" ? (
                        <Badge className="ms-2 border-success/40 text-success">{t("live")}</Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {c.callerPhone ?? (c.callerWithheld ? t("withheld") : "—")}
                    </td>
                    <td className="px-4 py-2" dir="auto">
                      {c.outcome ?? c.flow}
                      {c.records.map((r) => (
                        <Badge key={r.reference} className="ms-1 font-mono">
                          {r.reference}
                        </Badge>
                      ))}
                      {c.hasRecording ? (
                        <span className="ms-1" title={t("recorded")}>
                          ●
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums">
                      {formatDuration(c.durationSeconds)}
                    </td>
                    <td className={cn("px-4 py-2 text-end tabular-nums")}>
                      {c.medianLatencyMs === null ? "—" : `${c.medianLatencyMs} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
