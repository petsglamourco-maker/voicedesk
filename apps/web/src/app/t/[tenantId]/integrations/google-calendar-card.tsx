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

interface Connection {
  id: string;
  accountEmail: string | null;
  calendarId: string | null;
  calendarName: string | null;
  status: string;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface IntegrationsResponse {
  google: { available: boolean; canManage: boolean; connection: Connection | null };
}

const RESULTS = ["connected", "cancelled", "failed", "no_refresh_token"] as const;

/** Connect Google Calendar, choose the calendar bookings go into, see problems (ADR 0014). */
export function GoogleCalendarCard(props: {
  tenantId: string;
  initial: IntegrationsResponse["google"];
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

  useEffect(() => {
    if (!connection || !props.initial.canManage || connection.status === "revoked") return;
    let cancelled = false;
    api<{ calendars: typeof calendars }>(`${base}/google/calendars`)
      .then((r) => {
        if (!cancelled) setCalendars(r.calendars);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : common("errorGeneric"));
      });
    return () => {
      cancelled = true;
    };
  }, [connection, props.initial.canManage, base, common]);

  async function choose(id: string) {
    setBusy(true);
    setError(null);
    try {
      setConnection(
        await api<Connection>(`${base}/google/calendar`, {
          method: "PUT",
          body: JSON.stringify({ id }),
        }),
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
      await api(`${base}/google`, { method: "DELETE" });
      setConnection(null);
      setCalendars([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="google-calendar">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle>{t("googleTitle")}</CardTitle>
        {connection ? (
          connection.status === "active" ? (
            <Badge className="border-success/40 text-success">{t("statusActive")}</Badge>
          ) : connection.status === "revoked" ? (
            <Badge className="border-danger/40 text-danger">{t("statusRevoked")}</Badge>
          ) : (
            <Badge className="border-warning/40 text-warning">{t("statusError")}</Badge>
          )
        ) : null}
      </div>
      <CardDescription>{t("googleHint")}</CardDescription>

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
      {connection?.status !== "active" && connection?.lastError ? (
        <Alert className="mt-4" tone="error">
          {connection.status === "revoked" ? t("revokedHelp") : t("errorHelp")}
        </Alert>
      ) : null}

      {!props.initial.available ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("notConfigured")}</p>
      ) : !connection ? (
        props.initial.canManage ? (
          <a
            href={`${base}/google/start`}
            className="mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("connect")}
          </a>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{t("askOwner")}</p>
        )
      ) : (
        <div className="mt-4 space-y-4 text-sm">
          <p>
            {t("account")}: <span className="font-medium">{connection.accountEmail ?? "—"}</span>
          </p>
          {props.initial.canManage ? (
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
          {props.initial.canManage ? (
            <div className="flex gap-2">
              {connection.status === "revoked" ? (
                <a
                  href={`${base}/google/start`}
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
