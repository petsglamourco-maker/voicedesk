"use client";

import { Alert, Button, buttonVariants, cn, Field, Input } from "@voicedesk/ui";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { formString } from "@/lib/form";

export function ResetPasswordForm(props: { token: string }) {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = formString(form, "password");
    if (newPassword !== formString(form, "confirm")) return setError(t("passwordsDontMatch"));
    setPending(true);
    setError(null);
    const { error } = await authClient.resetPassword({ newPassword, token: props.token });
    setPending(false);
    if (error) {
      return setError(
        error.code === "INVALID_TOKEN"
          ? t("resetInvalid")
          : (error.message ?? common("errorGeneric")),
      );
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-5">
        <Alert tone="success">{t("resetDone")}</Alert>
        <Link className={cn(buttonVariants({ size: "lg" }), "w-full")} href="/sign-in">
          {t("signIn")}
        </Link>
      </div>
    );
  }
  return (
    <form method="post" onSubmit={(e) => void onSubmit(e)} className="space-y-5">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field id="password" label={t("newPassword")} hint={t("passwordHint")}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </Field>
      <Field id="confirm" label={t("confirmNewPassword")}>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        <KeyRound aria-hidden />
        {pending ? common("working") : t("resetSave")}
      </Button>
    </form>
  );
}
