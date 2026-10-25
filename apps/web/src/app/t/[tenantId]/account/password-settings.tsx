"use client";

import { Alert, Button, Card, CardHead, Checkbox, Field, Input } from "@voicedesk/ui";
import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { formString } from "@/lib/form";

/** Change password; by default this also signs out every other device. */
export function PasswordSettings() {
  const t = useTranslations("account");
  const auth = useTranslations("auth");
  const common = useTranslations("common");
  const router = useRouter();
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const newPassword = formString(form, "newPassword");
    if (newPassword !== formString(form, "confirm")) return setError(auth("passwordsDontMatch"));
    setPending(true);
    setError(null);
    setSaved(false);
    const { error } = await authClient.changePassword({
      currentPassword: formString(form, "currentPassword"),
      newPassword,
      revokeOtherSessions: signOutOthers,
    });
    setPending(false);
    if (error) return setError(error.message ?? common("errorGeneric"));
    formEl.reset();
    setSaved(true);
    router.refresh();
  }

  return (
    <Card>
      <CardHead icon={<KeyRound />} title={t("passwordTitle")} hint={t("passwordHint")} />
      {error ? (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert tone="success" className="mt-4">
          {t("passwordSaved")}
        </Alert>
      ) : null}
      <form
        method="post"
        onSubmit={(e) => void onSubmit(e)}
        className="mt-5 grid gap-4 sm:max-w-md"
      >
        <Field id="current-password" label={t("currentPassword")}>
          <Input
            id="current-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field id="new-password" label={auth("newPassword")} hint={auth("passwordHint")}>
          <Input
            id="new-password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </Field>
        <Field id="confirm-password" label={auth("confirmNewPassword")}>
          <Input
            id="confirm-password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={signOutOthers}
            onCheckedChange={(on) => setSignOutOthers(on === true)}
          />
          {t("signOutOthers")}
        </label>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? common("working") : t("changePassword")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
