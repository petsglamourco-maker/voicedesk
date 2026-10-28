"use client";

import { Alert, Badge, Button } from "@voicedesk/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client-api";

export interface PlatformCountry {
  code: string;
  name: string;
  currency: string;
  status: "launched" | "preview";
  launched: boolean;
  emergencyNumber: string | null;
  needsLegalReview: boolean;
  smsRegistration: string | null;
  smsRegistered: boolean;
}

/** Launch switches per country pack, and texting registration (US A2P 10DLC). */
export function CountriesForm(props: { countries: PlatformCountry[] }) {
  const t = useTranslations("platformCountries");
  const router = useRouter();
  const [launched, setLaunched] = useState(
    props.countries.filter((c) => c.launched && c.status === "preview").map((c) => c.code),
  );
  const [registered, setRegistered] = useState(
    props.countries.filter((c) => c.smsRegistered).map((c) => c.code),
  );
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], code: string, on: boolean) =>
    on ? [...new Set([...list, code])] : list.filter((c) => c !== code);

  return (
    <form
      method="post"
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("/api/platform/countries", {
            method: "PUT",
            body: JSON.stringify({ launched, smsRegistered: registered }),
          });
          toast.success(t("saved"));
          router.refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Alert tone="warning">{t("legal")}</Alert>
      <ul className="divide-y divide-border" data-testid="country-list">
        {props.countries.map((c) => {
          const builtIn = c.status === "launched";
          return (
            <li key={c.code} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
              <div className="min-w-48 flex-1">
                <p className="font-medium">
                  {c.name}{" "}
                  <span className="text-xs text-muted-foreground">
                    {c.currency} · {t("emergency", { number: c.emergencyNumber ?? "–" })}
                  </span>
                </p>
                {c.needsLegalReview && !builtIn ? (
                  <Badge tone="warning" className="mt-1">
                    {t("review")}
                  </Badge>
                ) : null}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={builtIn || launched.includes(c.code)}
                  disabled={builtIn}
                  onChange={(e) => setLaunched((l) => toggle(l, c.code, e.target.checked))}
                />
                {builtIn ? t("alwaysOpen") : t("open")}
              </label>
              {c.smsRegistration ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={registered.includes(c.code)}
                    onChange={(e) => setRegistered((l) => toggle(l, c.code, e.target.checked))}
                  />
                  {t("texting")}
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t("textingHint")}</p>
      <Button type="submit" disabled={busy}>
        {t("save")}
      </Button>
    </form>
  );
}
