import { Badge, Card, CardTitle } from "@voicedesk/ui";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { apiGetOrNull, type AuditEntry, type TenantDetail } from "@/lib/api";

export default async function TenantOverview(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const detail = await apiGetOrNull<TenantDetail>(`/api/tenants/${tenantId}`);
  if (!detail) notFound();
  const { tenant, role, permissions } = detail;
  const audit = permissions.includes("audit:read")
    ? await apiGetOrNull<AuditEntry[]>(`/api/tenants/${tenantId}/audit?limit=10`)
    : null;

  const t = await getTranslations("tenant");
  const roles = await getTranslations("roles");
  const languages = await getTranslations("languages");
  const onboarding = await getTranslations("onboarding");
  const format = await getFormatter();

  const rows: Array<[string, string]> = [
    [t("country"), onboarding(`countries.${tenant.countryCode}` as "countries.GB")],
    [t("timezone"), tenant.timezone.replaceAll("_", " ")],
    [t("language"), languages(tenant.defaultLanguage as "en")],
    [t("dataRegion"), tenant.dataRegion.toUpperCase()],
    [t("status"), t(`statuses.${tenant.status}`)],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{tenant.name}</h1>
        <Badge>
          {t("yourRole")}: {roles(role)}
        </Badge>
      </div>

      <Card>
        <CardTitle>{t("details")}</CardTitle>
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {audit ? (
        <Card>
          <CardTitle>{t("recentActivity")}</CardTitle>
          {audit.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("noActivity")}</p>
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
  );
}
