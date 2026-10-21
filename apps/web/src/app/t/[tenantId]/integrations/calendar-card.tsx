"use client";

import {
  Alert,
  Button,
  buttonVariants,
  Card,
  CardHead,
  cn,
  EmptyState,
  Label,
  Select,
  StatusPill,
  useConfirm,
} from "@voicedesk/ui";
import {
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Link2,
  Lock,
  PlugZap,
  RefreshCw,
  TriangleAlert,
  Unplug,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
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

const PROVIDER_META: Record<Provider, { icon: LucideIcon; color: string }> = {
  google: { icon: CalendarDays, color: "var(--color-secondary)" },
  microsoft: { icon: CalendarRange, color: "var(--color-info)" },
};

/** The provider's icon in a tinted, softly glowing tile. */
function ProviderIcon(props: { provider: Provider; glow?: boolean }) {
  const { icon: Icon, color } = PROVIDER_META[props.provider];
  return (
    <span
      aria-hidden
      className="flex size-11 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5"
      style={{
        color,
        background: "color-mix(in srgb, " + color + " 14%, transparent)",
        boxShadow: props.glow ? "0 0 18px -4px " + color : undefined,
      }}
    >
      <Icon />
    </span>
  );
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
  const confirm = useConfirm();
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
    if (!(await confirm({ title: t("confirmDisconnect"), destructive: true }))) return;
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
    <li
      key={p}
      className="glass flex flex-wrap items-center gap-3 rounded-xl p-4 transition-[border-color,box-shadow] duration-300 hover:border-input hover:shadow-[0_8px_30px_-14px_var(--color-glow)]"
    >
      <ProviderIcon provider={p} />
      <span className="min-w-0 flex-1 basis-40 font-display font-semibold">{providerName(p)}</span>
      <a href={`${base}/${p}/start`} className={buttonVariants({ size: "sm", shape: "pill" })}>
        <Link2 aria-hidden />
        {t("connectWith", { provider: providerName(p) })}
      </a>
    </li>
  );
  const available = (["google", "microsoft"] as const).filter((p) => props.initial.available[p]);

  return (
    <Card data-testid="calendar-integration">
      <CardHead
        icon={<CalendarDays />}
        title={t("calendarTitle")}
        hint={t("calendarHint")}
        color="var(--color-secondary)"
      />

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
          <EmptyState
            icon={PlugZap}
            title={t("notConfigured")}
            className="py-8 [&>p]:max-w-xl [&>p]:text-sm [&>p]:font-medium"
          />
        ) : canManage ? (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            {available.map(connectLink)}
          </ul>
        ) : (
          <EmptyState
            icon={Lock}
            title={t("askOwner")}
            className="py-8 [&>p]:max-w-xl [&>p]:text-sm [&>p]:font-medium"
          />
        )
      ) : (
        <div
          className={cn(
            "mt-5 rounded-xl border p-4 text-sm sm:p-5",
            connection.status === "active"
              ? "border-success/35 bg-success/5"
              : connection.status === "revoked"
                ? "border-danger/35 bg-danger/5"
                : "border-warning/35 bg-warning/5",
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <ProviderIcon provider={connection.provider} glow={connection.status === "active"} />
            <div className="min-w-0 flex-1 basis-40">
              <p className="font-display text-base font-semibold">
                {providerName(connection.provider)}
              </p>
              <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <UserRound className="size-3.5 shrink-0" aria-hidden />
                <span>{t("account")}:</span>
                <span className="truncate font-medium text-foreground">
                  {connection.accountEmail ?? "—"}
                </span>
              </p>
            </div>
            {connection.status === "active" && !connection.calendarId ? (
              <StatusPill tone="warning" icon={TriangleAlert} label={t("statusPickCalendar")} />
            ) : connection.status === "active" ? (
              <StatusPill tone="success" icon={CheckCircle2} label={t("statusActive")} />
            ) : connection.status === "revoked" ? (
              <StatusPill tone="danger" icon={XCircle} label={t("statusRevoked")} />
            ) : (
              <StatusPill tone="warning" icon={TriangleAlert} label={t("statusError")} />
            )}
          </div>

          <div className="mt-4 space-y-4 border-t border-border pt-4">
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
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                    {t("pickToFinish")}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">{t("howItWorks")}</p>
                )}
              </div>
            ) : (
              <p>
                {t("calendar")}:{" "}
                <span className="font-medium" dir="auto">
                  {connection.calendarName ?? "—"}
                </span>
              </p>
            )}
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                {connection.status === "revoked" ? (
                  <a
                    href={`${base}/${connection.provider}/start`}
                    className={buttonVariants({ size: "sm", shape: "pill" })}
                  >
                    <RefreshCw aria-hidden />
                    {t("reconnect")}
                  </a>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  <Unplug aria-hidden />
                  {t("disconnect")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}
