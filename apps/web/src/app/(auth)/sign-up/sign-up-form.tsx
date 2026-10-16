"use client";

import { Alert, Button, Input, Label } from "@voicedesk/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { formString } from "@/lib/form";

export function SignUpForm({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = formString(form, "email");
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: formString(form, "name"),
      email,
      password: formString(form, "password"),
      // Where the emailed verification link lands once confirmed.
      callbackURL: redirectTo,
    });
    setPending(false);
    if (error) {
      setError(error.message ?? common("errorGeneric"));
      return;
    }
    router.push(`/check-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" autoComplete="name" required minLength={2} />
      </div>
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="mt-1 text-xs text-muted-foreground">
          {t("passwordHint")}
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? common("working") : t("signUp")}
      </Button>
    </form>
  );
}
