"use client";

import { Alert, Button, Card, CardHead, Input, Label, StatusPill } from "@voicedesk/ui";
import { KeyRound, LockKeyhole, ShieldAlert, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { formString } from "@/lib/form";

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations("account");
  const common = useTranslations("common");
  // Short On/Off labels (account has none of its own yet).
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
    <Card
      style={
        enabled
          ? {
              borderColor: "color-mix(in srgb, var(--color-success) 35%, transparent)",
              boxShadow: "0 0 40px -18px var(--color-success)",
            }
          : undefined
      }
    >
      <CardHead
        icon={<ShieldCheck />}
        title={t("twoFactor")}
        hint={enabled ? t("twoFactorOn") : t("twoFactorOff")}
        color={enabled ? "var(--color-success)" : "var(--color-warning)"}
        aside={
          enabled ? (
            <StatusPill tone="success" live icon={ShieldCheck} label={t("on")} />
          ) : (
            <StatusPill tone="warning" icon={ShieldAlert} label={t("off")} />
          )
        }
      />
      <div className="mt-5 space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}

        {setup ? (
          <form method="post" onSubmit={onVerify} className="space-y-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                <KeyRound aria-hidden className="size-4 shrink-0 text-primary" />
                {t("setupUri")}
              </p>
              <code
                className="glass mt-2 block rounded-lg px-3 py-2.5 font-mono text-xs break-all"
                dir="ltr"
              >
                {setup.totpURI}
              </code>
            </div>
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                <LockKeyhole aria-hidden className="size-4 shrink-0 text-warning" />
                {t("backupCodes")}
              </p>
              <ul
                className="mt-2 grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4 [&>*]:min-w-0"
                dir="ltr"
              >
                {setup.backupCodes.map((c) => (
                  <li
                    key={c}
                    className="tabular truncate rounded-md border border-dashed border-input px-2 py-1.5 text-center"
                  >
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div className="max-w-xs">
              <Label htmlFor="code">{t("enterCode")}</Label>
              <Input
                className="tabular font-mono tracking-[0.3em]"
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
            method="post"
            onSubmit={(e) => void onPassword(e, enabled ? "disable" : "enable")}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="min-w-0 basis-64">
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
