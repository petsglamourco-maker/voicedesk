"use client";

import { Alert, Button, Card, CardDescription, CardTitle, Input, Label } from "@voicedesk/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { formString } from "@/lib/form";

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations("account");
  const common = useTranslations("common");
  const router = useRouter();
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onPassword(event: FormEvent<HTMLFormElement>, mode: "enable" | "disable") {
    event.preventDefault();
    const password = formString(new FormData(event.currentTarget), "password");
    setPending(true);
    setError(null);
    const result =
      mode === "enable"
        ? await authClient.twoFactor.enable({ password })
        : await authClient.twoFactor.disable({ password });
    setPending(false);
    if (result.error) return setError(result.error.message ?? common("errorGeneric"));
    if (mode === "enable" && result.data && "totpURI" in result.data) {
      setSetup({ totpURI: result.data.totpURI, backupCodes: result.data.backupCodes });
    } else {
      router.refresh();
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = formString(new FormData(event.currentTarget), "code").replace(/\s/g, "");
    setPending(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) return setError(error.message ?? common("errorGeneric"));
    setSetup(null);
    setNotice(t("enabled"));
    router.refresh();
  }

  return (
    <Card>
      <CardTitle>{t("twoFactor")}</CardTitle>
      <CardDescription>{enabled ? t("twoFactorOn") : t("twoFactorOff")}</CardDescription>
      <div className="mt-4 space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}

        {setup ? (
          <form onSubmit={onVerify} className="space-y-4">
            <div>
              <p className="text-sm">{t("setupUri")}</p>
              <code className="mt-2 block break-all rounded bg-muted p-3 text-xs">
                {setup.totpURI}
              </code>
            </div>
            <div>
              <p className="text-sm">{t("backupCodes")}</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs sm:grid-cols-4">
                {setup.backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <div className="max-w-xs">
              <Label htmlFor="code">{t("enterCode")}</Label>
              <Input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </div>
            <Button type="submit" disabled={pending}>
              {t("finish")}
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => void onPassword(e, enabled ? "disable" : "enable")}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="min-w-64">
              <Label htmlFor="password">{t("confirmPassword")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" variant={enabled ? "secondary" : "primary"} disabled={pending}>
              {enabled ? t("disable") : t("enable")}
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}
