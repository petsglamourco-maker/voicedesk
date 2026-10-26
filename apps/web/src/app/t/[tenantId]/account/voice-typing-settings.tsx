"use client";

import { Alert, Card, CardHead, Skeleton } from "@voicedesk/ui";
import { Mic } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

interface VoiceTypingStatus {
  available: boolean;
  on: boolean;
}

/** Voice typing for me (ADR 0027): show or hide the microphone in text fields. */
export function VoiceTypingSettings() {
  const t = useTranslations("voiceTyping");
  const common = useTranslations("common");
  const router = useRouter();
  const [status, setStatus] = useState<VoiceTypingStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api<VoiceTypingStatus>("/api/me/voice-typing")
      .then((s) => live && setStatus(s))
      .catch(() => live && setError(common("errorGeneric")));
    return () => {
      live = false;
    };
  }, [common]);

  async function change(on: boolean) {
    setPending(true);
    setError(null);
    try {
      await api("/api/me/voice-typing", { method: "PUT", body: JSON.stringify({ on }) });
      setStatus((s) => (s ? { ...s, on } : s));
      // The microphone's visibility comes from the layout, so refresh it.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card data-testid="voice-typing-settings">
      <CardHead icon={<Mic />} title={t("accountTitle")} hint={t("accountHint")} />
      {error ? (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      ) : null}
      {!status ? (
        <Skeleton className="mt-5 h-12" />
      ) : !status.available ? (
        <p className="mt-5 text-sm text-muted-foreground">{t("notSetUp")}</p>
      ) : (
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3 text-sm has-[:checked]:border-primary/50 has-[:checked]:bg-primary/8 has-[:disabled]:opacity-60">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={status.on}
            disabled={pending}
            onChange={(e) => void change(e.target.checked)}
          />
          <span>
            <span className="block font-medium">{t("personal")}</span>
            <span className="mt-0.5 block text-muted-foreground">{t("personalHint")}</span>
          </span>
        </label>
      )}
    </Card>
  );
}
