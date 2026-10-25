import {
  Avatar,
  Badge,
  Card,
  CardHead,
  EmptyState,
  StatusPill,
  type StatusTone,
} from "@voicedesk/ui";
import {
  CalendarCheck,
  CalendarClock,
  CircleHelp,
  Hash,
  Inbox,
  MailCheck,
  MailX,
  MessageSquareText,
  PhoneCall,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { KnowledgeGaps, type Gap } from "./knowledge-gaps";
import { AiCallBack, BookingCancel, MessageDone, TicketStatus } from "./record-actions";
import { ScreenHero } from "@/components/screen-hero";

export const metadata: Metadata = { title: "Records" };

interface Records {
  signups: Array<{
    id: string;
    reference: string | null;
    fullName: string | null;
    phone: string | null;
    email: string | null;
    interest: string | null;
    marketingConsent: boolean;
    createdAt: string;
  }>;
  knowledgeGaps: Gap[];
  tickets: Array<{
    id: string;
    reference: string;
    priority: string;
    status: string;
    summary: string | null;
    callbackPhone: string | null;
    callbackTime: string | null;
    createdAt: string;
  }>;
  messages: Array<{
    id: string;
    reference: string;
    callerName: string;
    callerPhone: string;
    reason: string;
    urgency: string;
    status: string;
    forStaff: string | null;
    createdAt: string;
  }>;
  bookings: Array<{
    id: string;
    reference: string;
    service: string;
    startsAt: string;
    customerName: string;
    customerPhone: string | null;
    status: string;
  }>;
}

/** Badge tone for ticket priority / message urgency. */
const URGENCY_TONE: Record<string, StatusTone> = {
  urgent: "danger",
  high: "warning",
  normal: "neutral",
  low: "neutral",
};

const ROW =
  "rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-primary/40";

export default async function RecordsPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [detail, records] = await Promise.all([
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
    apiGetOrNull<Records>(`/api/tenants/${tenantId}/records`),
  ]);
  if (!detail || !records) notFound();
  const t = await getTranslations("records");
  const shell = await getTranslations("shell");
  const format = await getFormatter();
  const tz = detail.tenant.timezone;
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  const canEdit = detail.permissions.includes("records:write");
  const empty = <EmptyState icon={Inbox} title={t("empty")} className="py-8" />;

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="records"
        eyebrow={shell("groups.customers")}
        title={t("title")}
        description={t("subtitle")}
      />

      <Card>
        <CardHead icon={<UserPlus />} title={t("signups")} color="var(--color-success)" />
        {records.signups.length === 0 ? (
          empty
        ) : (
          <ul className="mt-4 space-y-2" data-testid="signups">
            {records.signups.map((c) => (
              <li key={c.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${ROW}`}>
                <Avatar name={c.fullName ?? c.phone ?? c.email ?? "?"} size="sm" />
                {c.reference ? (
                  <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {c.reference}
                  </span>
                ) : null}
                <span className="font-medium" dir="auto">
                  {c.fullName}
                </span>
                <span className="tabular text-muted-foreground">
                  {[c.phone, c.email].filter(Boolean).join(" · ")}
                </span>
                {c.interest ? (
                  <Badge tone="accent" dir="auto" className="whitespace-normal">
                    {c.interest}
                  </Badge>
                ) : null}
                <StatusPill
                  tone={c.marketingConsent ? "success" : "neutral"}
                  icon={c.marketingConsent ? MailCheck : MailX}
                  label={c.marketingConsent ? t("marketingYes") : t("marketingNo")}
                />
                <span className="tabular ms-auto text-xs text-muted-foreground">
                  {when(c.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead
          icon={<CircleHelp />}
          title={t("gaps")}
          hint={t("gapsHint")}
          color="var(--color-warning)"
        />
        <KnowledgeGaps
          tenantId={tenantId}
          gaps={records.knowledgeGaps}
          canEdit={detail.permissions.includes("knowledge:write")}
        />
      </Card>

      <Card>
        <CardHead icon={<TriangleAlert />} title={t("tickets")} color="var(--color-danger)" />
        {records.tickets.length === 0 ? (
          empty
        ) : (
          <ul className="mt-4 space-y-2">
            {records.tickets.map((r) => (
              <li key={r.id} className={ROW}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="font-mono">
                    <Hash aria-hidden />
                    {r.reference}
                  </Badge>
                  <Badge tone={URGENCY_TONE[r.priority] ?? "neutral"}>{r.priority}</Badge>
                  <span className="tabular ms-auto text-xs text-muted-foreground">
                    {when(r.createdAt)}
                  </span>
                  <TicketStatus tenantId={tenantId} id={r.id} status={r.status} canEdit={canEdit} />
                  {r.callbackPhone ? (
                    <AiCallBack
                      tenantId={tenantId}
                      sourceType="ticket"
                      id={r.id}
                      canEdit={canEdit}
                    />
                  ) : null}
                </div>
                <p className="mt-2" dir="auto">
                  {r.summary}
                </p>
                <p className="tabular mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <PhoneCall className="size-3 shrink-0" aria-hidden />
                  {t("callback", { phone: r.callbackPhone ?? "—", time: r.callbackTime ?? "—" })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead
          icon={<MessageSquareText />}
          title={t("messages")}
          color="var(--color-secondary)"
        />
        {records.messages.length === 0 ? (
          empty
        ) : (
          <ul className="mt-4 space-y-2">
            {records.messages.map((m) => (
              <li key={m.id} className={ROW}>
                <div className="flex flex-wrap items-center gap-2">
                  <Avatar name={m.callerName} size="sm" />
                  <span className="font-medium" dir="auto">
                    {m.callerName}
                  </span>
                  <span className="tabular text-muted-foreground">{m.callerPhone}</span>
                  <Badge className="font-mono">
                    <Hash aria-hidden />
                    {m.reference}
                  </Badge>
                  <Badge tone={URGENCY_TONE[m.urgency] ?? "neutral"}>{m.urgency}</Badge>
                  <span className="tabular ms-auto text-xs text-muted-foreground">
                    {when(m.createdAt)}
                  </span>
                  <MessageDone tenantId={tenantId} id={m.id} status={m.status} canEdit={canEdit} />
                  {m.status !== "done" ? (
                    <AiCallBack
                      tenantId={tenantId}
                      sourceType="message"
                      id={m.id}
                      canEdit={canEdit}
                    />
                  ) : null}
                </div>
                <p className="mt-2" dir="auto">
                  {m.forStaff ? (
                    <span className="font-medium">{`${t("for", { name: m.forStaff })} `}</span>
                  ) : (
                    ""
                  )}
                  {m.reason}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHead icon={<CalendarCheck />} title={t("bookings")} color="var(--color-primary)" />
        {records.bookings.length === 0 ? (
          empty
        ) : (
          <ul className="mt-4 space-y-2">
            {records.bookings.map((b) => (
              <li key={b.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${ROW}`}>
                <Badge className="font-mono">
                  <Hash aria-hidden />
                  {b.reference}
                </Badge>
                <span className="font-medium" dir="auto">
                  {b.service}
                </span>
                <span className="tabular flex items-center gap-1.5 text-muted-foreground">
                  <CalendarClock className="size-3.5 shrink-0" aria-hidden />
                  {when(b.startsAt)}
                </span>
                <span className="flex items-center gap-2">
                  <Avatar name={b.customerName} size="sm" />
                  <span dir="auto">
                    {b.customerName}
                    {b.customerPhone ? ` · ${b.customerPhone}` : ""}
                  </span>
                </span>
                <span className="ms-auto">
                  <BookingCancel
                    tenantId={tenantId}
                    id={b.id}
                    status={b.status}
                    canEdit={canEdit}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
