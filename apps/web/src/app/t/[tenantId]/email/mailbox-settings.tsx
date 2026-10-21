"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Input,
  Label,
  Select,
} from "@voicedesk/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { ScreenHero } from "@/components/screen-hero";

interface MailServer {
  host: string;
  port: number;
  secure: boolean;
}

export interface MailboxView {
  id: string;
  emailAddress: string;
  username: string;
  imap: MailServer;
  smtp: MailServer;
  folder: string;
  autoSend: boolean;
  status: string;
  lastError: string | null;
  lastPolledAt: string | null;
}

export interface MailboxInfo {
  mailbox: MailboxView | null;
  presets: Record<string, { imap: MailServer; smtp: MailServer }>;
  encryptionReady: boolean;
}

const EMPTY_SERVER: MailServer = { host: "", port: 993, secure: true };

/** Connect the business's support mailbox (IMAP + SMTP with an app password). */
export function MailboxSettings(props: {
  tenantId: string;
  initial: MailboxInfo;
  canEdit: boolean;
}) {
  const t = useTranslations("email");
  const shell = useTranslations("shell");
  const common = useTranslations("common");
  const base = `/api/tenants/${props.tenantId}/mailbox`;
  const [mailbox, setMailbox] = useState(props.initial.mailbox);
  const existing = props.initial.mailbox;
  const [form, setForm] = useState({
    preset: existing ? "custom" : "gmail",
    emailAddress: existing?.emailAddress ?? "",
    username: existing?.username ?? "",
    password: "",
    imap: existing?.imap ?? props.initial.presets.gmail?.imap ?? EMPTY_SERVER,
    smtp: existing?.smtp ?? props.initial.presets.gmail?.smtp ?? { ...EMPTY_SERVER, port: 465 },
    folder: existing?.folder ?? "INBOX",
    autoSend: existing?.autoSend ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function choosePreset(preset: string) {
    const servers = props.initial.presets[preset];
    setForm({ ...form, preset, ...(servers ? { imap: servers.imap, smtp: servers.smtp } : {}) });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const res = await api<{ mailbox: MailboxView }>(base, {
        method: "PUT",
        body: JSON.stringify({
          emailAddress: form.emailAddress,
          username: form.username || form.emailAddress,
          ...(form.password ? { password: form.password } : {}),
          imap: form.imap,
          smtp: form.smtp,
          folder: form.folder,
          autoSend: form.autoSend,
        }),
      });
      setMailbox(res.mailbox);
      setForm({ ...form, password: "" });
      setNotice(t("connected"));
    });

  const test = () =>
    run(async () => {
      const res = await api<{ ok: boolean; error?: string }>(`${base}/test`, { method: "POST" });
      if (res.ok) setNotice(t("testOk"));
      else setError(res.error ?? common("errorGeneric"));
    });

  const disconnect = () =>
    run(async () => {
      if (!window.confirm(t("confirmDisconnect"))) return;
      await api(base, { method: "DELETE" });
      setMailbox(null);
      setNotice(t("disconnected"));
    });

  const server = (kind: "imap" | "smtp") => (
    <div className="grid gap-2 sm:grid-cols-[1fr_90px_140px]">
      <div>
        <Label htmlFor={`${kind}-host`}>{t(kind === "imap" ? "imapHost" : "smtpHost")}</Label>
        <Input
          id={`${kind}-host`}
          value={form[kind].host}
          disabled={!props.canEdit}
          onChange={(e) => setForm({ ...form, [kind]: { ...form[kind], host: e.target.value } })}
        />
      </div>
      <div>
        <Label htmlFor={`${kind}-port`}>{t("port")}</Label>
        <Input
          id={`${kind}-port`}
          type="number"
          value={form[kind].port}
          disabled={!props.canEdit}
          onChange={(e) =>
            setForm({ ...form, [kind]: { ...form[kind], port: Number(e.target.value) } })
          }
        />
      </div>
      <div>
        <Label htmlFor={`${kind}-secure`}>{t("security")}</Label>
        <Select
          id={`${kind}-secure`}
          value={form[kind].secure ? "tls" : "starttls"}
          disabled={!props.canEdit}
          onChange={(e) =>
            setForm({ ...form, [kind]: { ...form[kind], secure: e.target.value === "tls" } })
          }
        >
          <option value="tls">TLS</option>
          <option value="starttls">STARTTLS</option>
        </Select>
      </div>
    </div>
  );

  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="email"
        eyebrow={shell("groups.channels")}
        title={t("title")}
        description={t("subtitle")}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {!props.initial.encryptionReady ? <Alert tone="error">{t("noEncryptionKey")}</Alert> : null}

      {mailbox ? (
        <Card>
          <div className="flex items-center gap-2">
            <CardTitle>{mailbox.emailAddress}</CardTitle>
            {mailbox.status === "active" ? (
              <Badge tone="success">{t("statusActive")}</Badge>
            ) : (
              <Badge tone="danger">{t("statusError")}</Badge>
            )}
          </div>
          <CardDescription>
            {mailbox.lastPolledAt
              ? t("lastChecked", { when: new Date(mailbox.lastPolledAt).toLocaleString() })
              : t("notCheckedYet")}
          </CardDescription>
          {mailbox.lastError ? (
            <p className="mt-2 text-sm text-danger" data-testid="mailbox-error">
              {mailbox.lastError}
            </p>
          ) : null}
          <p className="mt-2 text-sm">{mailbox.autoSend ? t("modeAuto") : t("modeReview")}</p>
          {props.canEdit ? (
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void test()}>
                {t("test")}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disconnect()}>
                {t("disconnect")}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {props.canEdit ? (
        <Card>
          <CardTitle>{mailbox ? t("change") : t("connect")}</CardTitle>
          <CardDescription>{t("connectHint")}</CardDescription>
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="preset">{t("provider")}</Label>
                <Select
                  id="preset"
                  value={form.preset}
                  onChange={(e) => choosePreset(e.target.value)}
                >
                  {Object.keys(props.initial.presets).map((p) => (
                    <option key={p} value={p}>
                      {t(`presets.${p}` as "presets.gmail")}
                    </option>
                  ))}
                  <option value="custom">{t("presets.custom")}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="address">{t("address")}</Label>
                <Input
                  id="address"
                  type="email"
                  value={form.emailAddress}
                  placeholder="hello@yourbusiness.co.uk"
                  onChange={(e) => setForm({ ...form, emailAddress: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="username">{t("username")}</Label>
                <Input
                  id="username"
                  value={form.username}
                  placeholder={form.emailAddress || t("usernameHint")}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="password">{t("password")}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  placeholder={mailbox ? t("passwordKeep") : ""}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t("appPasswordHint")}</p>
            {form.preset === "custom" ? (
              <div className="space-y-3">
                {server("imap")}
                {server("smtp")}
                <div className="max-w-xs">
                  <Label htmlFor="folder">{t("folder")}</Label>
                  <Input
                    id="folder"
                    value={form.folder}
                    onChange={(e) => setForm({ ...form, folder: e.target.value })}
                  />
                </div>
              </div>
            ) : null}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("replies")}</legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="autoSend"
                  className="mt-1"
                  checked={!form.autoSend}
                  onChange={() => setForm({ ...form, autoSend: false })}
                />
                <span>{t("modeReviewOption")}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="autoSend"
                  className="mt-1"
                  checked={form.autoSend}
                  onChange={() => setForm({ ...form, autoSend: true })}
                />
                <span>{t("modeAutoOption")}</span>
              </label>
            </fieldset>
            <Button
              disabled={busy || !props.initial.encryptionReady || !form.emailAddress}
              onClick={() => void save()}
            >
              {busy ? t("checking") : t("save")}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
