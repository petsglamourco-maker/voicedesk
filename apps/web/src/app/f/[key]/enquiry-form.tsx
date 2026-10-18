"use client";

import { Alert, Button, Input, Label } from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

export function EnquiryForm(props: { formKey: string; businessName: string }) {
  const t = useTranslations("hostedForm");
  const common = useTranslations("common");
  // When the page opened: very fast submissions are bots.
  const [openedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = formString(data, "email").trim();
    const phone = formString(data, "phone").trim();
    if (!email && !phone) {
      setError(t("needContact"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/public/forms/${encodeURIComponent(props.formKey)}`, {
        method: "POST",
        body: JSON.stringify({
          name: formString(data, "name").trim(),
          email,
          phone: phone || undefined,
          message: formString(data, "message").trim(),
          consent: data.get("consent") === "on",
          marketing: data.get("marketing") === "on",
          website: formString(data, "website"),
          elapsedMs: Date.now() - openedAt,
        }),
      });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Alert tone="success" className="mt-4" data-testid="form-sent">
        {t("thanks", { business: props.businessName })}
      </Alert>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" required maxLength={100} autoComplete="name" dir="auto" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="email">{t("email")}</Label>
          <Input id="email" name="email" type="email" maxLength={254} autoComplete="email" />
        </div>
        <div>
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input id="phone" name="phone" type="tel" maxLength={30} autoComplete="tel" />
        </div>
      </div>
      <div>
        <Label htmlFor="message">{t("message")}</Label>
        <textarea
          id="message"
          name="message"
          required
          maxLength={4000}
          dir="auto"
          className="mt-1 h-32 w-full rounded-md border border-border bg-background p-2 text-sm"
        />
      </div>
      {/* Honeypot: hidden from people and screen readers. */}
      <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" required className="mt-1" />
        <span>{t("consent", { business: props.businessName })}</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="marketing" className="mt-1" />
        <span>{t("marketing", { business: props.businessName })}</span>
      </label>
      <p className="text-xs text-muted-foreground">{t("aiNote")}</p>
      <Button type="submit" disabled={busy}>
        {busy ? common("working") : t("send")}
      </Button>
    </form>
  );
}
