"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Label,
  Select,
} from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

type Provider = "google" | "microsoft";

interface Connection {
  id: string;
  provider: Provider;
  accountEmail: string | null;
  calendarId: string | null;
  calendarName: string | null;
  status: string;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface IntegrationsResponse {
  calendar: {
    available: Record<Provider, boolean>;
    canManage: boolean;
    connection: Connection | null;
  };
}

const RESULTS = ["connected", "cancelled", "failed", "no_refresh_token"] as const;

/** Connect Google Calendar or Microsoft 365, choose the booking calendar (ADR 0014). */
export function CalendarCard(props: {
  tenantId: string;
  initial: IntegrationsResponse["calendar"];
  result: string | null;
}) {
  const t = useTranslations("integrations");
  const common = useTranslations("common");
  const [connection, setConnection] = useState(props.initial.connection);
  const [calendars, setCalendars] = useState<Array<{ id: string; name: string; primary: boolean }>>(
    [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/tenants/${props.tenantId}/integrations`;
  const result = RESULTS.find((r) => r === props.result) ?? null;
  const canManage = props.initial.canManage;

  useEffect(() => {
    if (!connection || !canManage || connection.status === "revoked") return;
    let cancelled = false;
    api<{ calendars: typeof calendars }>(`${base}/calendar/calendars`)
      .then((r) => {
        if (!cancelled) setCalendars(r.calendars);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : common("errorGeneric"));
      });
    return () => {
      cancelled = true;
    };
  }, [connection, canManage, base, common]);

  async function choose(id: string) {
    setBusy(true);
    setError(null);
    try {
      setConnection(
        await api<Connection>(`${base}/calendar`, { method: "PUT", body: JSON.stringify({ id }) }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(t("confirmDisconnect"))) return;
    setBusy(true);
    try {
      await api(`${base}/calendar`, { method: "DELETE" });
      setConnection(null);
      setCalendars([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const providerName = (p: Provider) => t(`provider.${p}`);
  const connectLink = (p: Provider) => (
    <a
      key={p}
      href={`${base}/${p}/start`}
      className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
    >
      {t("connectWith", { provider: providerName(p) })}
    </a>
  );
  const available = (["google", "microsoft"] as const).filter((p) => props.initial.available[p]);

  return (
    <Card data-testid="calendar-integration">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle>{t("calendarTitle")}</CardTitle>
        {connection ? (
          <>
            <Badge>{providerName(connection.provider)}</Badge>
            {connection.status === "active" ? (
              <Badge tone="success">{t("statusActive")}</Badge>
            ) : connection.status === "revoked" ? (
              <Badge tone="danger">{t("statusRevoked")}</Badge>
            ) : (
              <Badge tone="warning">{t("statusError")}</Badge>
            )}
          </>
        ) : null}
      </div>
      <CardDescription>{t("calendarHint")}</CardDescription>

      {result ? (
        <Alert className="mt-4" tone={result === "connected" ? "success" : "error"}>
          {t(`result.${result}`)}
        </Alert>
      ) : null}
      {error ? (
        <Alert className="mt-4" tone="error">
          {error}
        </Alert>
      ) : null}
      {connection && connection.status !== "active" && connection.lastError ? (
        <Alert className="mt-4" tone="error">
          {connection.status === "revoked" ? t("revokedHelp") : t("errorHelp")}
        </Alert>
      ) : null}

      {!connection ? (
        available.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("notConfigured")}</p>
        ) : canManage ? (
          <div className="mt-4 flex flex-wrap gap-2">{available.map(connectLink)}</div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{t("askOwner")}</p>
        )
      ) : (
        <div className="mt-4 space-y-4 text-sm">
          <p>
            {t("account")}: <span className="font-medium">{connection.accountEmail ?? "—"}</span>
          </p>
          {canManage ? (
            <div className="max-w-sm">
              <Label htmlFor="calendar">{t("calendar")}</Label>
              <Select
                id="calendar"
                value={connection.calendarId ?? ""}
                disabled={busy || calendars.length === 0}
                onChange={(e) => void choose(e.target.value)}
              >
                <option value="" disabled>
                  {calendars.length ? t("chooseCalendar") : common("working")}
                </option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.primary ? ` (${t("primary")})` : ""}
                  </option>
                ))}
              </Select>
              {!connection.calendarId ? (
                <p className="mt-2 text-xs text-warning">{t("pickToFinish")}</p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">{t("howItWorks")}</p>
              )}
            </div>
          ) : (
            <p>
              {t("calendar")}: {connection.calendarName ?? "—"}
            </p>
          )}
          {canManage ? (
            <div className="flex gap-2">
              {connection.status === "revoked" ? (
                <a
                  href={`${base}/${connection.provider}/start`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {t("reconnect")}
                </a>
              ) : null}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disconnect()}>
                {t("disconnect")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
