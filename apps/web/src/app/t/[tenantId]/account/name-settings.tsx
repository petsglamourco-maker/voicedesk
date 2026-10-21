"use client";

import { Alert, Button, Card, CardHead, Input, Label } from "@voicedesk/ui";
import { UserCog } from "lucide-react";
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
      <CardHead icon={<UserCog />} title={t("nameTitle")} hint={t("nameHint")} />
      {error ? (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      ) : null}
      {saved ? (
        <Alert tone="success" className="mt-4">
          {t("nameSaved")}
        </Alert>
      ) : null}
      <form onSubmit={(e) => void save(e)} className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-0 basis-64">
          <Label htmlFor="display-name">{t("name")}</Label>
          <Input
            id="display-name"
            name="name"
            required
            maxLength={100}
            defaultValue={props.name}
            autoComplete="name"
            className="w-full sm:w-64"
            dir="auto"
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? common("working") : t("saveName")}
        </Button>
      </form>
    </Card>
  );
}
