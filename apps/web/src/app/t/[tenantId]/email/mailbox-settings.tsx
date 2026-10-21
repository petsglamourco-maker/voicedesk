"use client";

import {
  Alert,
  Button,
  Card,
  CardHead,
  Input,
  Label,
  Select,
  StatusPill,
  useConfirm,
} from "@voicedesk/ui";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  KeyRound,
  Mail,
  MailCheck,
  PlugZap,
  Send,
  Server,
  ShieldCheck,
  Unplug,
} from "lucide-react";
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

const EMAIL = "var(--color-ch-email)";

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
  const confirm = useConfirm();
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
      if (!(await confirm({ title: t("confirmDisconnect"), destructive: true }))) return;
      await api(base, { method: "DELETE" });
      setMailbox(null);
      setNotice(t("disconnected"));
    });

  const server = (kind: "imap" | "smtp") => (
    <div className="grid gap-3 sm:grid-cols-[1fr_90px_140px] [&>*]:min-w-0">
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
        <Card
          style={
            mailbox.status === "active"
              ? {
                  borderColor: `color-mix(in srgb, ${EMAIL} 38%, transparent)`,
                  boxShadow: `0 0 40px -16px ${EMAIL}`,
                }
              : undefined
          }
        >
          <CardHead
            icon={<MailCheck />}
            title={
              <span dir="auto" className="break-all">
                {mailbox.emailAddress}
              </span>
            }
            hint={
              mailbox.lastPolledAt
                ? t("lastChecked", { when: new Date(mailbox.lastPolledAt).toLocaleString() })
                : t("notCheckedYet")
            }
            color={EMAIL}
            aside={
              mailbox.status === "active" ? (
                <StatusPill tone="success" live icon={CheckCircle2} label={t("statusActive")} />
              ) : (
                <StatusPill tone="danger" icon={AlertTriangle} label={t("statusError")} />
              )
            }
          />
          {mailbox.lastError ? (
            <p
              className="mt-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
              data-testid="mailbox-error"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span dir="auto" className="min-w-0 break-words">
                {mailbox.lastError}
              </span>
            </p>
          ) : null}
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_55%,transparent)] px-3 py-2.5 text-sm">
            {mailbox.autoSend ? (
              <Send aria-hidden className="mt-0.5 size-4 shrink-0" style={{ color: EMAIL }} />
            ) : (
              <ShieldCheck
                aria-hidden
                className="mt-0.5 size-4 shrink-0"
                style={{ color: EMAIL }}
              />
            )}
            <span>{mailbox.autoSend ? t("modeAuto") : t("modeReview")}</span>
          </p>
          {props.canEdit ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void test()}>
                <PlugZap aria-hidden />
                {t("test")}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disconnect()}>
                <Unplug aria-hidden />
                {t("disconnect")}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {props.canEdit ? (
        <Card>
          <CardHead
            icon={<Mail />}
            title={mailbox ? t("change") : t("connect")}
            hint={t("connectHint")}
            color={EMAIL}
          />
          <div className="mt-6 space-y-6">
            <section className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
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
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <KeyRound
                  aria-hidden
                  className="mt-px size-3.5 shrink-0"
                  style={{ color: EMAIL }}
                />
                <span>{t("appPasswordHint")}</span>
              </p>
            </section>

            {form.preset === "custom" ? (
              <section className="space-y-3 border-t border-border pt-5">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-6 flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4"
                    style={{
                      color: EMAIL,
                      background: `color-mix(in srgb, ${EMAIL} 14%, transparent)`,
                    }}
                  >
                    <Server />
                  </span>
                  <div className="min-w-0 flex-1 space-y-3">
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
                </div>
              </section>
            ) : null}

            <div className="border-t border-border pt-5">
              <fieldset className="space-y-2">
                <legend className="flex items-center gap-2 text-sm font-semibold">
                  <Inbox aria-hidden className="size-4" style={{ color: EMAIL }} />
                  {t("replies")}
                </legend>
                <div className="grid gap-2 pt-2 sm:grid-cols-2 [&>*]:min-w-0">
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-input has-[:checked]:border-primary has-[:checked]:bg-primary/8">
                    <input
                      type="radio"
                      name="autoSend"
                      className="mt-1 accent-[var(--color-primary)]"
                      checked={!form.autoSend}
                      onChange={() => setForm({ ...form, autoSend: false })}
                    />
                    <span>{t("modeReviewOption")}</span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-input has-[:checked]:border-primary has-[:checked]:bg-primary/8">
                    <input
                      type="radio"
                      name="autoSend"
                      className="mt-1 accent-[var(--color-primary)]"
                      checked={form.autoSend}
                      onChange={() => setForm({ ...form, autoSend: true })}
                    />
                    <span>{t("modeAutoOption")}</span>
                  </label>
                </div>
              </fieldset>
            </div>
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
