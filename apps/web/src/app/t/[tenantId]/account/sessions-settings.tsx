"use client";

import { Alert, Badge, Button, Card, CardHead, Skeleton } from "@voicedesk/ui";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { describeDevice } from "@/lib/user-agent";

interface SessionRow {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** Where you're signed in, with "sign out" per device and for all other devices. */
export function SessionsSettings() {
  const t = useTranslations("account");
  const common = useTranslations("common");
  const format = useFormatter();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([authClient.listSessions(), authClient.getSession()]).then(
      ([list, current]) => {
        if (!live) return;
        if (list.error) return setError(list.error.message ?? common("errorGeneric"));
        const rows = [...(list.data as SessionRow[])].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        setSessions(rows);
        setCurrentId(current.data?.session.id ?? null);
      },
    );
    return () => {
      live = false;
    };
  }, [version, common]);

  async function run(action: () => Promise<{ error: { message?: string } | null }>) {
    setPending(true);
    setError(null);
    const { error } = await action();
    setPending(false);
    if (error) return setError(error.message ?? common("errorGeneric"));
    setVersion((v) => v + 1);
  }

  const others = (sessions ?? []).filter((s) => s.id !== currentId);
  return (
    <Card>
      <CardHead icon={<MonitorSmartphone />} title={t("sessionsTitle")} hint={t("sessionsHint")} />
      {error ? (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      ) : null}
      {sessions === null ? (
        <Skeleton className="mt-5 h-16 w-full" />
      ) : (
        <ul className="mt-5 divide-y divide-border" data-testid="session-list">
          {sessions.map((s) => {
            const device = describeDevice(s.userAgent);
            const name =
              device.browser && device.os
                ? t("deviceOn", { browser: device.browser, os: device.os })
                : (device.browser ?? device.os ?? t("unknownDevice"));
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {name}
                    {s.id === currentId ? <Badge tone="success">{t("thisDevice")}</Badge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("lastActive", {
                      when: format.relativeTime(new Date(s.updatedAt)),
                    })}
                    {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                  </p>
                </div>
                {s.id !== currentId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => void run(() => authClient.revokeSession({ token: s.token }))}
                  >
                    <LogOut aria-hidden />
                    {t("signOutDevice")}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 ? (
        <Button
          variant="secondary"
          className="mt-4"
          disabled={pending}
          onClick={() => void run(() => authClient.revokeOtherSessions())}
        >
          {t("signOutEverywhere")}
        </Button>
      ) : null}
    </Card>
  );
}
