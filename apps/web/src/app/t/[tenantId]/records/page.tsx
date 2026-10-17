import { Badge, Card, CardTitle } from "@voicedesk/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { apiGetOrNull, type TenantDetail } from "@/lib/api";
import { KnowledgeGaps, type Gap } from "./knowledge-gaps";

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

export default async function RecordsPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const [detail, records] = await Promise.all([
    apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`),
    apiGetOrNull<Records>(`/api/tenants/${tenantId}/records`),
  ]);
  if (!detail || !records) notFound();
  const t = await getTranslations("records");
  const format = await getFormatter();
  const tz = detail.tenant.timezone;
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  const empty = <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardTitle>{t("signups")}</CardTitle>
        {records.signups.length === 0 ? (
          empty
        ) : (
          <ul className="mt-3 divide-y divide-border" data-testid="signups">
            {records.signups.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                {c.reference ? <span className="font-mono font-medium">{c.reference}</span> : null}
                <span className="font-medium">{c.fullName}</span>
                <span className="text-muted-foreground">
                  {[c.phone, c.email].filter(Boolean).join(" · ")}
                </span>
                {c.interest ? <Badge>{c.interest}</Badge> : null}
                <span className="text-xs text-muted-foreground">
                  {c.marketingConsent ? t("marketingYes") : t("marketingNo")}
                </span>
                <span className="ms-auto text-xs text-muted-foreground">{when(c.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>{t("gaps")}</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t("gapsHint")}</p>
        <KnowledgeGaps
          tenantId={tenantId}
          gaps={records.knowledgeGaps}
          canEdit={detail.permissions.includes("knowledge:write")}
        />
      </Card>

      <Card>
        <CardTitle>{t("tickets")}</CardTitle>
        {records.tickets.length === 0 ? (
          empty
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {records.tickets.map((r) => (
              <li key={r.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{r.reference}</span>
                  <Badge>{r.priority}</Badge>
                  <Badge>{r.status}</Badge>
                  <span className="ms-auto text-xs text-muted-foreground">{when(r.createdAt)}</span>
                </div>
                <p className="mt-1">{r.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {t("callback", { phone: r.callbackPhone ?? "—", time: r.callbackTime ?? "—" })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>{t("messages")}</CardTitle>
        {records.messages.length === 0 ? (
          empty
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {records.messages.map((m) => (
              <li key={m.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-medium">{m.reference}</span>
                  <span>
                    {m.callerName} · {m.callerPhone}
                  </span>
                  <Badge>{m.urgency}</Badge>
                  <span className="ms-auto text-xs text-muted-foreground">{when(m.createdAt)}</span>
                </div>
                <p className="mt-1">
                  {m.forStaff ? `${t("for", { name: m.forStaff })} ` : ""}
                  {m.reason}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>{t("bookings")}</CardTitle>
        {records.bookings.length === 0 ? (
          empty
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {records.bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                <span className="font-mono font-medium">{b.reference}</span>
                <span>{b.service}</span>
                <span className="text-muted-foreground">{when(b.startsAt)}</span>
                <span>
                  {b.customerName}
                  {b.customerPhone ? ` · ${b.customerPhone}` : ""}
                </span>
                <Badge className="ms-auto">{b.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
