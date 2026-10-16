"use client";

import { Alert, Button, Input, Label } from "@voicedesk/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";
import { formString } from "@/lib/form";

export default function TwoFactorPage() {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = formString(new FormData(event.currentTarget), "code").replace(/\s/g, "");
    setPending(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) return setError(error.message ?? common("errorGeneric"));
    router.push("/");
    router.refresh();
  }

  return (
    <AuthShell title={t("twoFactorTitle")} description={t("twoFactorBody")}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div>
          <Label htmlFor="code">{t("code")}</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,7}"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? common("working") : t("verify")}
        </Button>
      </form>
    </AuthShell>
  );
}
