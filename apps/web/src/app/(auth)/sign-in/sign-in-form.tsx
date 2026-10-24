"use client";

import { Alert, Button, Input, Label } from "@voicedesk/ui";
import { LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { formString } from "@/lib/form";

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({
      email: formString(form, "email"),
      password: formString(form, "password"),
    });
    setPending(false);
    if (error) {
      setError(
        error.status === 403 ? t("emailNotVerified") : (error.message ?? common("errorGeneric")),
      );
      return;
    }
    // When 2FA is on, the client plugin redirects to /two-factor instead.
    if (data && !("twoFactorRedirect" in data && data.twoFactorRedirect)) {
      router.push(redirectTo);
      router.refresh();
    }
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5" noValidate={false}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <Label htmlFor="password" className="mb-0">
            {t("password")}
          </Label>
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("forgotLink")}
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
        <LogIn aria-hidden />
        {pending ? common("working") : t("signIn")}
      </Button>
    </form>
  );
}
