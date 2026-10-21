"use client";

import { Alert, Button, Celebrate, Input, Label, Textarea } from "@voicedesk/ui";
import { Bot, CheckCircle2, Send } from "lucide-react";
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
      <div
        role="status"
        className="mt-6 flex flex-col items-center py-4 text-center"
        data-testid="form-sent"
      >
        <span aria-hidden className="relative mb-5 flex size-16 items-center justify-center">
          <span className="absolute -inset-3 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-success)_40%,transparent),transparent_70%)] blur-lg" />
          <span className="relative flex size-16 items-center justify-center rounded-full border border-success/45 bg-success/15 text-success shadow-[0_0_28px_-6px_var(--color-success)]">
            <CheckCircle2 className="size-8" />
          </span>
          <Celebrate show />
        </span>
        <p className="max-w-sm text-[15px] leading-relaxed" dir="auto">
          {t("thanks", { business: props.businessName })}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-5">
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div>
        <Label htmlFor="name">{t("name")}</Label>
        <Input id="name" name="name" required maxLength={100} autoComplete="name" dir="auto" />
      </div>
      <div className="grid gap-5 sm:grid-cols-2 [&>*]:min-w-0">
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
        <Textarea
          id="message"
          name="message"
          required
          maxLength={4000}
          dir="auto"
          className="min-h-32"
        />
      </div>
      {/* Honeypot: hidden from people and screen readers. */}
      <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_45%,transparent)] p-4">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input type="checkbox" name="consent" required className="mt-0.5 size-4 accent-primary" />
          <span>{t("consent", { business: props.businessName })}</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input type="checkbox" name="marketing" className="mt-0.5 size-4 accent-primary" />
          <span>{t("marketing", { business: props.businessName })}</span>
        </label>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Bot className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>{t("aiNote")}</span>
      </p>
      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={busy}>
        <Send aria-hidden />
        {busy ? common("working") : t("send")}
      </Button>
    </form>
  );
}
