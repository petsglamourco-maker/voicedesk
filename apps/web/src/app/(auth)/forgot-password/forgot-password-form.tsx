"use client";

import { Alert, Button, Input, Label } from "@voicedesk/ui";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { formString } from "@/lib/form";

/** Asks for a reset link. The answer is the same whether or not the account exists. */
export function ForgotPasswordForm() {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = formString(new FormData(event.currentTarget), "email");
    setPending(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setPending(false);
    if (error) return setError(error.message ?? common("errorGeneric"));
    setSent(true);
  }

  if (sent) return <Alert tone="success">{t("forgotSent")}</Alert>;
  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="space-y-5">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        <Mail aria-hidden />
        {pending ? common("working") : t("forgotSend")}
      </Button>
    </form>
  );
}
