"use client";

import { Alert, Button, Card, CardDescription, CardTitle, Input, Label } from "@voicedesk/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { formString } from "@/lib/form";

/** Your display name: callers hear the first name when you take a call (VA console). */
export function NameSettings(props: { name: string }) {
  const t = useTranslations("account");
  const common = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = formString(new FormData(event.currentTarget), "name").trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await authClient.updateUser({ name });
    setBusy(false);
    if (res.error) {
      setError(res.error.message ?? common("errorGeneric"));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <Card>
      <CardTitle>{t("nameTitle")}</CardTitle>
      <CardDescription>{t("nameHint")}</CardDescription>
      {error ? (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert tone="success" className="mt-3">
          {t("nameSaved")}
        </Alert>
      ) : null}
      <form onSubmit={(e) => void save(e)} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="display-name">{t("name")}</Label>
          <Input
            id="display-name"
            name="name"
            required
            maxLength={100}
            defaultValue={props.name}
            autoComplete="name"
            className="w-64"
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? common("working") : t("saveName")}
        </Button>
      </form>
    </Card>
  );
}
