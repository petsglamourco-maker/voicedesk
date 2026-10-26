import { Badge, Card, CardHead, HeroStat, StatusPill, cn, type StatusTone } from "@voicedesk/ui";
import {
  AudioLines,
  Bot,
  Clock,
  Flag,
  Gauge,
  Hash,
  Headset,
  ListChecks,
  MessagesSquare,
  PhoneForwarded,
  PhoneMissed,
  Sparkles,
  Target,
  User,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ScreenHero } from "@/components/screen-hero";
import { apiGetOrNull } from "@/lib/api";
import { formatDuration, latencyStatus, type CallRow } from "../format";

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
  departmentMoves?: Array<{ at: string; via: string; name: string | null }>;
  followUp?: {
    status: string;
    sendAt: string;
    sentAt: string | null;
    channel: string;
    booked: boolean;
    reason: string | null;
  } | null;
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

/** Text colour per latency tone (full class names so Tailwind sees them). */
const TONE_TEXT: Partial<Record<StatusTone, string>> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

const sentimentTone = (v: string): StatusTone =>
  v === "positive" ? "success" : v === "negative" ? "danger" : "neutral";

export default async function CallPage(props: {
  params: Promise<{ tenantId: string; callId: string }>;
}) {
  const { tenantId, callId } = await props.params;
  const call = await apiGetOrNull<CallDetail>(`/api/tenants/${tenantId}/calls/${callId}`);
  if (!call) notFound();
  const t = await getTranslations("calls");
  const format = await getFormatter();
  const latency = latencyStatus(call.latency?.medianMs ?? null);
  const LatencyIcon = latency.icon;

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="calls"
        eyebrow={
          <Link href={`/t/${tenantId}/calls`} className="hover:underline">
            <span aria-hidden className="rtl:hidden">
              ←{" "}
            </span>
            {t("back")}
          </Link>
        }
        title={format.dateTime(new Date(call.startedAt), { dateStyle: "full", timeStyle: "short" })}
        description={
          <>
            {call.callerPhone ?? (call.callerWithheld ? t("withheld") : "—")}
            {call.calledNumber ? ` → ${call.calledNumber}` : ""} ·{" "}
            {formatDuration(call.durationSeconds)}
            {call.test ? ` · ${t("test")}` : ""}
          </>
        }
      >
        <HeroStat
          icon={<Clock />}
          label={t("colDuration")}
          value={formatDuration(call.durationSeconds)}
          color="var(--color-ch-voice)"
        />
        {call.latency?.medianMs != null ? (
          <HeroStat
            icon={<Gauge />}
            label={t("latencyCall")}
            value={`${call.latency.medianMs} ms`}
            color={`var(--color-${latency.tone})`}
          />
        ) : null}
      </ScreenHero>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] [&>*]:min-w-0">
        <div className="space-y-6">
          {call.hasRecording ? (
            <Card variant="hero">
              <CardHead
                icon={<AudioLines />}
                title={t("recording")}
                hint={t("recordingHint")}
                color="var(--color-accent)"
              />
              <div className="mt-4 rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-3">
                <audio
                  controls
                  preload="none"
                  className="w-full"
                  src={`/api/tenants/${tenantId}/calls/${callId}/recording`}
                  data-testid="recording"
                />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHead
              icon={<MessagesSquare />}
              title={t("transcript")}
              color="var(--color-secondary)"
            />
            <ol className="mt-5 space-y-4" data-testid="transcript">
              {call.messages.map((m, i) => {
                const caller = m.role === "caller";
                return (
                  <li
                    key={i}
                    className={cn(
                      "flex items-end gap-2.5",
                      caller ? "flex-row-reverse" : "flex-row",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5",
                        caller ? "bg-primary/16 text-primary" : "bg-accent/16 text-accent",
                      )}
                    >
                      {caller ? <User /> : <Bot />}
                    </span>
                    <div
                      dir="auto"
                      className={cn(
                        "max-w-[80%] min-w-0 rounded-2xl px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap",
                        caller
                          ? "rounded-ee-sm bg-primary text-primary-foreground shadow-[0_0_20px_-6px_var(--color-glow)]"
                          : "rounded-es-sm border border-border bg-surface-raised",
                      )}
                    >
                      <span className="sr-only">{caller ? t("caller") : t("assistant")}: </span>
                      {m.content}
                      {m.withPerson ? (
                        <span className="mt-1.5 flex items-center gap-1 text-[11px] opacity-80">
                          <Headset className="size-3 shrink-0" aria-hidden />
                          {t("whileWithPerson")}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          {call.followUp ? (
            <Card className="p-4" data-testid="call-follow-up">
              <CardHead icon={<Clock />} title={t("followUpTitle")} color="var(--color-success)" />
              <p className="mt-3 text-sm">
                {call.followUp.booked
                  ? t("followUpBooked")
                  : call.followUp.status === "sent"
                    ? t("followUpSent", {
                        when: format.dateTime(
                          new Date(call.followUp.sentAt ?? call.followUp.sendAt),
                          {
                            dateStyle: "medium",
                            timeStyle: "short",
                          },
                        ),
                      })
                    : call.followUp.status === "skipped"
                      ? t("followUpSkipped")
                      : t("followUpScheduled", {
                          when: format.dateTime(new Date(call.followUp.sendAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })}
              </p>
            </Card>
          ) : null}
          {call.missedByTeam || call.departmentMoves?.length ? (
            <Card className="p-4" data-testid="call-department">
              <CardHead icon={<Flag />} title={t("routingTitle")} color="var(--color-primary)" />
              <ul className="mt-3 space-y-2 text-sm">
                {call.missedByTeam ? (
                  <li>
                    <StatusPill tone="warning" icon={PhoneForwarded} label={t("missedByTeam")} />
                  </li>
                ) : null}
                {call.departmentMoves?.map((m, i) => (
                  <li key={i}>
                    {t(`departmentVia.${m.via}`, { name: m.name ?? t("removedDepartment") })}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {call.handoffs?.length ? (
            <Card className="p-4" data-testid="handoffs">
              <CardHead icon={<Headset />} title={t("handoffTitle")} color="var(--color-accent)" />
              <ul className="mt-3 space-y-2 text-sm">
                {call.handoffs.map((h, i) => (
                  <li
                    key={i}
                    className="flex gap-2.5 rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-primary/40"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full [&_svg]:size-3",
                        h.answeredAt ? "bg-success/14 text-success" : "bg-danger/14 text-danger",
                      )}
                    >
                      {h.answeredAt ? <PhoneForwarded /> : <PhoneMissed />}
                    </span>
                    <span className="min-w-0 flex-1">
                      {h.answeredAt
                        ? t("handoffAnswered", {
                            name: h.answeredBy ?? "—",
                            wait: seconds(h.queuedAt, h.answeredAt) ?? 0,
                            talk: formatDuration(seconds(h.answeredAt, h.endedAt)),
                          })
                        : t("handoffMissed", { wait: seconds(h.queuedAt, h.endedAt) ?? 0 })}
                      {h.status === "returned" ? ` ${t("handoffReturned")}` : ""}
                      {h.reason ? (
                        <span className="mt-1 block text-xs text-muted-foreground" dir="auto">
                          “{h.reason}”
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="p-4">
            <CardHead icon={<Sparkles />} title={t("summary")} color="var(--color-accent)" />
            {call.summary ? (
              <div className="mt-3 space-y-3 text-sm" dir="auto">
                <p className="leading-relaxed">{call.summary.summary}</p>
                {call.summary.outcome ? (
                  <p className="flex gap-2 text-xs text-muted-foreground">
                    <Target className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0">{call.summary.outcome}</span>
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  {call.summary.intent ? (
                    <Badge tone="secondary">{call.summary.intent}</Badge>
                  ) : null}
                  {call.summary.sentiment ? (
                    <Badge tone={sentimentTone(call.summary.sentiment)}>
                      {call.summary.sentiment}
                    </Badge>
                  ) : null}
                </div>
                {call.summary.actionItems?.length ? (
                  <ul className="space-y-1.5 text-xs">
                    {call.summary.actionItems.map((a, i) => (
                      <li key={i} className="flex gap-2">
                        <ListChecks className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
                        <span className="min-w-0">{a}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {call.summary.followUpNeeded ? (
                  <StatusPill tone="warning" icon={Flag} label={t("followUp")} />
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{t("noSummary")}</p>
            )}
            {call.records.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {call.records.map((r) => (
                  <Badge key={r.reference} tone="secondary" className="font-mono">
                    <Hash aria-hidden />
                    {r.type} {r.reference}
                  </Badge>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="p-4">
            <CardHead icon={<Gauge />} title={t("latencyCall")} color="var(--color-info)" />
            <p className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t("median")}</span>
              <Badge tone={latency.tone} className="tabular">
                <LatencyIcon aria-hidden />
                {call.latency?.medianMs == null ? "—" : `${call.latency.medianMs} ms`}
              </Badge>
            </p>
            {call.latency?.turns.length ? (
              <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                <table className="tabular w-full text-xs">
                  <thead className="bg-[color-mix(in_srgb,var(--color-muted)_50%,transparent)] text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-start font-semibold">#</th>
                      <th className="px-2 py-1.5 text-end font-semibold">{t("colTurnEnd")}</th>
                      <th className="px-2 py-1.5 text-end font-semibold">{t("colReply")}</th>
                      <th className="px-2 py-1.5 text-end font-semibold">{t("colVoice")}</th>
                      <th className="px-2 py-1.5 text-end font-semibold">{t("colTotal")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {call.latency.turns.map((l, i) => (
                      <tr key={i} className="transition-colors hover:bg-muted/50">
                        <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1.5 text-end">{l.endOfUtteranceMs ?? "—"}</td>
                        <td className="px-2 py-1.5 text-end">
                          {l.llmFirstTextMs ?? "—"}
                          {l.filler ? "*" : ""}
                        </td>
                        <td className="px-2 py-1.5 text-end">{l.ttsFirstByteMs ?? "—"}</td>
                        <td
                          className={cn(
                            "px-2 py-1.5 text-end font-semibold",
                            TONE_TEXT[latencyStatus(l.totalMs ?? null).tone],
                          )}
                        >
                          {l.totalMs ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
