"use client";

import { Alert, Button, Input, Label } from "@voicedesk/ui";
import { ShieldCheck } from "lucide-react";
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
      <form onSubmit={onSubmit} className="space-y-5">
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
            className="tabular h-12 text-center font-display text-xl tracking-[0.4em]"
          />
        </div>
        <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
          <ShieldCheck aria-hidden />
          {pending ? common("working") : t("verify")}
        </Button>
      </form>
    </AuthShell>
  );
}
