"use client";

import { Button, Dialog, DialogContent, Field, Input } from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formString } from "@/lib/form";
import { registerReauthPrompt } from "@/lib/reauth";

/** "Confirm it's you" password dialog for sensitive admin actions (see lib/reauth). */
export function ReauthPrompt() {
  const t = useTranslations("reauth");
  const common = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(
    () =>
      registerReauthPrompt(
        () =>
          new Promise<boolean>((resolve) => {
            resolver.current?.(false);
            resolver.current = resolve;
            setError(null);
            setOpen(true);
          }),
      ),
    [],
  );

  function close(ok: boolean) {
    resolver.current?.(ok);
    resolver.current = null;
    setOpen(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const password = formString(new FormData(event.currentTarget), "password");
    const res = await fetch("/api/me/reauth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    setPending(false);
    if (res?.ok) return close(true);
    setError(
      res?.status === 401
        ? t("wrong")
        : res?.status === 429
          ? t("tooMany")
          : common("errorGeneric"),
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close(false))}>
      {open ? (
        <DialogContent title={t("title")} description={t("description")}>
          <form method="post" className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
            <Field id="reauth-password" label={t("password")} error={error}>
              <Input
                id="reauth-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "reauth-password-error" : undefined}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                {common("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? common("working") : t("confirm")}
              </Button>
            </div>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
