"use client";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHead,
  Input,
  Label,
  StatusPill,
  buttonVariants,
  useConfirm,
  type StatusTone,
} from "@voicedesk/ui";
import {
  Bot,
  CalendarCheck,
  FileUp,
  Hash,
  Mail,
  MailCheck,
  MailX,
  MessageSquareText,
  MessagesSquare,
  PenLine,
  Pencil,
  Phone,
  PhoneOff,
  Sparkles,
  StickyNote,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { ChannelDot } from "@/components/channels";
import { ScreenHero } from "@/components/screen-hero";
import { api } from "@/lib/client-api";
import { formString } from "@/lib/form";

interface Contact {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  source: string | null;
  interest: string | null;
  marketingConsent: boolean;
  doNotCall?: boolean;
}

export interface ContactDetailResponse {
  contact: Contact;
  conversations: Array<{
    id: string;
    channel: string;
    style: string;
    startedAt: string;
    outcome: string | null;
  }>;
  bookings: Array<{
    id: string;
    reference: string;
    service: string;
    startsAt: string;
    status: string;
  }>;
  tickets: Array<{
    id: string;
    reference: string;
    status: string;
    priority: string;
    summary: string | null;
    createdAt: string;
  }>;
  messages: Array<{
    id: string;
    reference: string;
    reason: string;
    status: string;
    createdAt: string;
  }>;
}

const SOURCE_LOOK: Record<string, { tone: StatusTone; icon: LucideIcon }> = {
  assistant: { tone: "accent", icon: Bot },
  import: { tone: "secondary", icon: FileUp },
  manual: { tone: "neutral", icon: PenLine },
};

/** Badge tone for booking / ticket / message statuses. */
const STATUS_TONE: Record<string, StatusTone> = {
  confirmed: "success",
  cancelled: "neutral",
  open: "warning",
  in_progress: "info",
  resolved: "success",
  closed: "neutral",
  new: "info",
  done: "success",
};

const ROW =
  "rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:border-primary/40";

/** One contact: details (editable) and everything the assistant has done for them. */
export function ContactDetail(props: { tenantId: string; initial: ContactDetailResponse }) {
  const t = useTranslations("contacts");
  const common = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const confirm = useConfirm();
  const [contact, setContact] = useState(props.initial.contact);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/tenants/${props.tenantId}/contacts/${contact.id}`;
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      setContact(
        await api<Contact>(url, {
          method: "PATCH",
          body: JSON.stringify({
            fullName: formString(form, "fullName") || null,
            phone: formString(form, "phone") || null,
            email: formString(form, "email") || null,
            notes: formString(form, "notes") || null,
            marketingConsent: form.get("marketingConsent") === "on",
            doNotCall: form.get("doNotCall") === "on",
          }),
        }),
      );
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirm({ title: t("confirmDelete"), destructive: true }))) return;
    setBusy(true);
    try {
      await api(url, { method: "DELETE" });
      router.push(`/t/${props.tenantId}/contacts`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : common("errorGeneric"));
      setBusy(false);
    }
  }

  const d = props.initial;
  return (
    <div className="stagger space-y-6">
      <ScreenHero
        icon="contacts"
        eyebrow={
          <Link href={`/t/${props.tenantId}/contacts`} className="hover:underline">
            <span aria-hidden className="rtl:hidden">
              ←{" "}
            </span>
            {t("back")}
          </Link>
        }
        title={contact.fullName ?? contact.phone ?? contact.email}
        titleProps={{ dir: "auto" }}
        actions={<Avatar name={contact.fullName ?? contact.phone ?? "?"} size="lg" />}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        {editing ? (
          <form method="post" onSubmit={(e) => void save(e)} className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="fullName">{t("field.fullName")}</Label>
              <Input id="fullName" name="fullName" defaultValue={contact.fullName ?? ""} />
            </div>
            <div>
              <Label htmlFor="phone">{t("field.phone")}</Label>
              <Input id="phone" name="phone" defaultValue={contact.phone ?? ""} />
            </div>
            <div>
              <Label htmlFor="email">{t("field.email")}</Label>
              <Input id="email" name="email" type="email" defaultValue={contact.email ?? ""} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes">{t("field.notes")}</Label>
              <Input id="notes" name="notes" defaultValue={contact.notes ?? ""} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                className="size-4 accent-primary"
                type="checkbox"
                name="marketingConsent"
                defaultChecked={contact.marketingConsent}
              />
              {t("field.marketingConsent")}
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                className="size-4 accent-primary"
                type="checkbox"
                name="doNotCall"
                defaultChecked={contact.doNotCall}
              />
              {t("field.doNotCall")}
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? common("working") : t("save")}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="flex gap-3 rounded-lg border border-border px-3 py-2.5">
                <Phone className="mt-0.5 size-4 shrink-0 text-ch-voice" aria-hidden />
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{t("field.phone")}</dt>
                  <dd className="tabular font-medium">{contact.phone ?? "—"}</dd>
                </div>
              </div>
              <div className="flex gap-3 rounded-lg border border-border px-3 py-2.5">
                <Mail className="mt-0.5 size-4 shrink-0 text-ch-email" aria-hidden />
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{t("field.email")}</dt>
                  <dd className="font-medium break-words">{contact.email ?? "—"}</dd>
                </div>
              </div>
              <div className="flex gap-3 rounded-lg border border-border px-3 py-2.5 sm:col-span-2">
                <StickyNote className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{t("field.notes")}</dt>
                  <dd dir="auto">{contact.notes ?? "—"}</dd>
                </div>
              </div>
              {contact.interest ? (
                <div className="flex gap-3 rounded-lg border border-border px-3 py-2.5">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{t("interest")}</dt>
                    <dd dir="auto">{contact.interest}</dd>
                  </div>
                </div>
              ) : null}
            </dl>
            <div className="flex flex-wrap gap-1.5">
              <StatusPill
                tone={contact.marketingConsent ? "success" : "neutral"}
                icon={contact.marketingConsent ? MailCheck : MailX}
                label={contact.marketingConsent ? t("marketingYes") : t("marketingNo")}
              />
              {contact.doNotCall ? (
                <StatusPill tone="danger" icon={PhoneOff} label={t("doNotCall")} />
              ) : null}
              {contact.source ? (
                <StatusPill
                  tone={(SOURCE_LOOK[contact.source] ?? SOURCE_LOOK.manual!).tone}
                  icon={(SOURCE_LOOK[contact.source] ?? SOURCE_LOOK.manual!).icon}
                  label={t(`source.${contact.source}` as "source.manual")}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {contact.phone && !contact.doNotCall ? (
                <Link
                  href={`/va?tenant=${props.tenantId}&dial=${encodeURIComponent(contact.phone)}&contact=${contact.id}`}
                  className={buttonVariants({ size: "sm" })}
                >
                  <Phone aria-hidden />
                  {t("call")}
                </Link>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                {t("edit")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger"
                onClick={() => void remove()}
                disabled={busy}
              >
                <Trash2 aria-hidden />
                {t("delete")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHead icon={<MessagesSquare />} title={t("calls")} color="var(--color-ch-voice)" />
          <ul className="mt-4 space-y-2 text-sm">
            {d.conversations.length === 0 ? <li className="text-muted-foreground">—</li> : null}
            {d.conversations.map((c) => (
              <li key={c.id} className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 ${ROW}`}>
                <ChannelDot
                  channel={c.channel}
                  size="sm"
                  label={
                    t.has(`channel.${c.channel}`)
                      ? t(`channel.${c.channel}` as "channel.voice")
                      : undefined
                  }
                />
                <span className="tabular">
                  {c.style === "voice" ? (
                    <Link
                      href={`/t/${props.tenantId}/calls/${c.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {when(c.startedAt)}
                    </Link>
                  ) : (
                    when(c.startedAt)
                  )}
                </span>{" "}
                <span className="min-w-0 text-muted-foreground" dir="auto">
                  {c.outcome ?? t(`channel.${c.channel}` as "channel.voice")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHead icon={<CalendarCheck />} title={t("bookings")} color="var(--color-primary)" />
          <ul className="mt-4 space-y-2 text-sm">
            {d.bookings.length === 0 ? <li className="text-muted-foreground">—</li> : null}
            {d.bookings.map((b) => (
              <li key={b.id} className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${ROW}`}>
                <Badge className="font-mono">
                  <Hash aria-hidden />
                  {b.reference}
                </Badge>{" "}
                <span className="font-medium" dir="auto">
                  {b.service}
                </span>
                <span className="tabular text-muted-foreground">· {when(b.startsAt)}</span>
                {b.status !== "confirmed" ? (
                  <Badge tone={STATUS_TONE[b.status] ?? "neutral"} className="ms-auto">
                    {b.status}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHead icon={<TriangleAlert />} title={t("tickets")} color="var(--color-danger)" />
          <ul className="mt-4 space-y-2 text-sm">
            {d.tickets.length === 0 ? <li className="text-muted-foreground">—</li> : null}
            {d.tickets.map((x) => (
              <li
                key={x.id}
                dir="auto"
                className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${ROW}`}
              >
                <Badge className="font-mono">
                  <Hash aria-hidden />
                  {x.reference}
                </Badge>{" "}
                <span className="min-w-0 flex-1">{x.summary}</span>{" "}
                <Badge tone={STATUS_TONE[x.status] ?? "neutral"}>{x.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHead
            icon={<MessageSquareText />}
            title={t("messages")}
            color="var(--color-secondary)"
          />
          <ul className="mt-4 space-y-2 text-sm">
            {d.messages.length === 0 ? <li className="text-muted-foreground">—</li> : null}
            {d.messages.map((m) => (
              <li
                key={m.id}
                dir="auto"
                className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${ROW}`}
              >
                <Badge className="font-mono">
                  <Hash aria-hidden />
                  {m.reference}
                </Badge>{" "}
                <span className="min-w-0 flex-1">{m.reason}</span>{" "}
                <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
