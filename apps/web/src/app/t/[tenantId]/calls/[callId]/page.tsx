import { Badge, Card, CardTitle, cn } from "@voicedesk/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { apiGetOrNull } from "@/lib/api";
import { formatDuration, latencyTone, type CallRow } from "../format";

export const metadata: Metadata = { title: "Call" };

interface CallDetail extends CallRow {
  summary: {
    summary?: string;
    intent?: string;
    outcome?: string;
    actionItems?: string[];
    sentiment?: string;
    followUpNeeded?: boolean;
  } | null;
  latency: {
    medianMs: number | null;
    turns: Array<{
      endOfUtteranceMs?: number;
      llmFirstTextMs?: number;
      ttsFirstByteMs?: number;
      totalMs?: number;
      filler?: boolean;
    }>;
  } | null;
  messages: Array<{ role: string; content: string; createdAt: string; withPerson?: boolean }>;
  handoffs?: Array<{
    status: string;
    reason: string | null;
    queuedAt: string;
    answeredAt: string | null;
    endedAt: string | null;
    answeredBy: string | null;
  }>;
}

const seconds = (from: string, to: string | null) =>
  to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000)) : null;

export default async function CallPage(props: {
  params: Promise<{ tenantId: string; callId: string }>;
}) {
  const { tenantId, callId } = await props.params;
  const call = await apiGetOrNull<CallDetail>(`/api/tenants/${tenantId}/calls/${callId}`);
  if (!call) notFound();
  const t = await getTranslations("calls");
  const format = await getFormatter();

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/t/${tenantId}/calls`} className="text-sm text-primary hover:underline">
          ← {t("back")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {format.dateTime(new Date(call.startedAt), { dateStyle: "full", timeStyle: "short" })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {call.callerPhone ?? (call.callerWithheld ? t("withheld") : "—")}
          {call.calledNumber ? ` → ${call.calledNumber}` : ""} ·{" "}
          {formatDuration(call.durationSeconds)}
          {call.test ? ` · ${t("test")}` : ""}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {call.hasRecording ? (
            <Card>
              <CardTitle className="text-base">{t("recording")}</CardTitle>
              <audio
                controls
                preload="none"
                className="mt-3 w-full"
                src={`/api/tenants/${tenantId}/calls/${callId}/recording`}
                data-testid="recording"
              />
              <p className="mt-2 text-xs text-muted-foreground">{t("recordingHint")}</p>
            </Card>
          ) : null}

          <Card>
            <CardTitle className="text-base">{t("transcript")}</CardTitle>
            <div className="mt-3 space-y-3" data-testid="transcript">
              {call.messages.map((m, i) => (
                <div
                  key={i}
                  className={cn("flex", m.role === "caller" ? "justify-end" : "justify-start")}
                >
                  <div
                    dir="auto"
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                      m.role === "caller"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-muted",
                    )}
                  >
                    <span className="sr-only">
                      {m.role === "caller" ? t("caller") : t("assistant")}:{" "}
                    </span>
                    {m.content}
                    {m.withPerson ? (
                      <span className="mt-1 block text-[11px] opacity-70">
                        {t("whileWithPerson")}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {call.handoffs?.length ? (
            <Card className="p-4" data-testid="handoffs">
              <CardTitle className="text-base">{t("handoffTitle")}</CardTitle>
              <ul className="mt-2 space-y-2 text-sm">
                {call.handoffs.map((h, i) => (
                  <li key={i}>
                    {h.answeredAt
                      ? t("handoffAnswered", {
                          name: h.answeredBy ?? "—",
                          wait: seconds(h.queuedAt, h.answeredAt) ?? 0,
                          talk: formatDuration(seconds(h.answeredAt, h.endedAt)),
                        })
                      : t("handoffMissed", { wait: seconds(h.queuedAt, h.endedAt) ?? 0 })}
                    {h.status === "returned" ? ` ${t("handoffReturned")}` : ""}
                    {h.reason ? (
                      <span className="block text-xs text-muted-foreground" dir="auto">
                        “{h.reason}”
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <Card className="p-4">
            <CardTitle className="text-base">{t("summary")}</CardTitle>
            {call.summary ? (
              <div className="mt-2 space-y-2 text-sm" dir="auto">
                <p>{call.summary.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {call.summary.intent} · {call.summary.outcome} · {call.summary.sentiment}
                </p>
                {call.summary.actionItems?.length ? (
                  <ul className="list-disc ps-5 text-xs">
                    {call.summary.actionItems.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                ) : null}
                {call.summary.followUpNeeded ? (
                  <Badge className="border-warning/40 text-warning">{t("followUp")}</Badge>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t("noSummary")}</p>
            )}
            {call.records.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {call.records.map((r) => (
                  <Badge key={r.reference} className="font-mono">
                    {r.type} {r.reference}
                  </Badge>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="p-4">
            <CardTitle className="text-base">{t("latencyCall")}</CardTitle>
            <p className="mt-2 text-sm">
              {t("median")}{" "}
              <Badge className={latencyTone(call.latency?.medianMs ?? null)}>
                {call.latency?.medianMs == null ? "—" : `${call.latency.medianMs} ms`}
              </Badge>
            </p>
            {call.latency?.turns.length ? (
              <table className="mt-3 w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-start font-normal">#</th>
                    <th className="text-end font-normal">{t("colTurnEnd")}</th>
                    <th className="text-end font-normal">{t("colReply")}</th>
                    <th className="text-end font-normal">{t("colVoice")}</th>
                    <th className="text-end font-normal">{t("colTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {call.latency.turns.map((l, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td className="text-end">{l.endOfUtteranceMs ?? "—"}</td>
                      <td className="text-end">
                        {l.llmFirstTextMs ?? "—"}
                        {l.filler ? "*" : ""}
                      </td>
                      <td className="text-end">{l.ttsFirstByteMs ?? "—"}</td>
                      <td className="text-end font-medium">{l.totalMs ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
