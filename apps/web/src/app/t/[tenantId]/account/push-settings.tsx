"use client";

import { Alert, Button, Card, CardHead, Skeleton, StatusPill } from "@voicedesk/ui";
import { BellRing } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

interface PushStatus {
  available: boolean;
  publicKey: string | null;
  devices: number;
  thisSession: boolean;
}

type Support = "ok" | "insecure" | "unsupported" | "install";

/** The VAPID public key as the bytes PushManager.subscribe expects. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function detectSupport(): Support {
  if (!window.isSecureContext) return "insecure";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches;
  if (ios && !installed) return "install"; // iPhone: push only works once added to Home Screen
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  return "ok";
}

/**
 * Push notifications on this phone or browser (ADR 0024): chats waiting for a person, calls
 * ringing for people who answer, urgent alerts and allowance warnings. No customer details
 * are ever in a notification.
 */
export function PushSettings() {
  const t = useTranslations("account.push");
  const common = useTranslations("common");
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [support, setSupport] = useState<Support | null>(null);
  const [version, setVersion] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api<PushStatus>("/api/me/push")
      .then((s) => {
        if (!live) return;
        setStatus(s);
        setSupport(detectSupport());
      })
      .catch(() => live && setError(common("errorGeneric")));
    return () => {
      live = false;
    };
  }, [version, common]);

  async function run(action: () => Promise<string | null>) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  const turnOn = () =>
    run(async () => {
      if (!status?.publicKey) return null;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error(t("blocked"));
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(status.publicKey),
        }));
      await api("/api/me/push", {
        method: "POST",
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      return t("on");
    });

  const turnOff = () =>
    run(async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      await api("/api/me/push", {
        method: "DELETE",
        body: JSON.stringify(subscription ? { endpoint: subscription.endpoint } : {}),
      });
      await subscription?.unsubscribe();
      return t("off");
    });

  const test = () =>
    run(async () => {
      await api("/api/me/push/test", { method: "POST" });
      return t("testSent");
    });

  return (
    <Card data-testid="push-settings">
      <CardHead
        icon={<BellRing />}
        title={t("title")}
        hint={t("hint")}
        aside={status?.thisSession ? <StatusPill tone="success" label={t("onPill")} /> : undefined}
      />
      {error ? (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="success" className="mt-4">
          {notice}
        </Alert>
      ) : null}
      <div className="mt-4 space-y-3 text-sm">
        {!status || !support ? (
          <Skeleton className="h-10 w-48" />
        ) : !status.available ? (
          <p className="text-muted-foreground">{t("notSetUp")}</p>
        ) : support !== "ok" ? (
          <p className="text-muted-foreground">{t(`support.${support}`)}</p>
        ) : status.thisSession ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => void test()}>
              {t("test")}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => void turnOff()}>
              {t("turnOff")}
            </Button>
          </div>
        ) : (
          <Button disabled={pending} onClick={() => void turnOn()}>
            {pending ? common("working") : t("turnOn")}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">{t("privacy")}</p>
      </div>
    </Card>
  );
}
