"use client";

import { Alert, Badge, Button, Card, CardTitle, Input, Label } from "@voicedesk/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
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

/** One contact: details (editable) and everything the assistant has done for them. */
export function ContactDetail(props: { tenantId: string; initial: ContactDetailResponse }) {
  const t = useTranslations("contacts");
  const common = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
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
    if (!window.confirm(t("confirmDelete"))) return;
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
    <div className="space-y-6">
      <div>
        <Link
          href={`/t/${props.tenantId}/contacts`}
          className="text-sm text-primary hover:underline"
        >
          ← {t("back")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight" dir="auto">
          {contact.fullName ?? contact.phone ?? contact.email}
        </h1>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        {editing ? (
          <form onSubmit={(e) => void save(e)} className="grid gap-3 sm:grid-cols-2">
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
                type="checkbox"
                name="marketingConsent"
                defaultChecked={contact.marketingConsent}
              />
              {t("field.marketingConsent")}
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="doNotCall" defaultChecked={contact.doNotCall} />
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
          <div className="space-y-2 text-sm">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("field.phone")}</dt>
                <dd>{contact.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("field.email")}</dt>
                <dd>{contact.email ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t("field.notes")}</dt>
                <dd dir="auto">{contact.notes ?? "—"}</dd>
              </div>
              {contact.interest ? (
                <div>
                  <dt className="text-muted-foreground">{t("interest")}</dt>
                  <dd dir="auto">{contact.interest}</dd>
                </div>
              ) : null}
            </dl>
            <div className="flex flex-wrap gap-1">
              <Badge>{contact.marketingConsent ? t("marketingYes") : t("marketingNo")}</Badge>
              {contact.doNotCall ? (
                <Badge className="border-danger/40 text-danger">{t("doNotCall")}</Badge>
              ) : null}
              {contact.source ? (
                <Badge>{t(`source.${contact.source}` as "source.manual")}</Badge>
              ) : null}
            </div>
            <div className="flex gap-2 pt-2">
              {contact.phone && !contact.doNotCall ? (
                <Link
                  href={`/va?tenant=${props.tenantId}&dial=${encodeURIComponent(contact.phone)}&contact=${contact.id}`}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {t("call")}
                </Link>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                {t("edit")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy}>
                {t("delete")}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle className="text-base">{t("calls")}</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {d.conversations.length === 0 ? <li className="text-muted-foreground">—</li> : null}
            {d.conversations.map((c) => (
              <li key={c.id}>
                {c.style === "voice" ? (
                  <Link
                    href={`/t/${props.tenantId}/calls/${c.id}`}
                    className="text-primary hover:underline"
                  >
                    {when(c.startedAt)}
                  </Link>
                ) : (
                  when(c.startedAt)
                )}{" "}
                <span className="text-muted-foreground" dir="auto">
                  {c.outcome ?? t(`channel.${c.channel}` as "channel.voice")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle className="text-base">{t("bookings")}</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {d.bookings.length === 0 ? <li className="text-muted-foreground">—</li> : null}
            {d.bookings.map((b) => (
              <li key={b.id}>
                <span className="font-mono">{b.reference}</span> {b.service} · {when(b.startsAt)}
                {b.status !== "confirmed" ? <Badge className="ms-2">{b.status}</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle className="text-base">{t("tickets")}</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {d.tickets.length === 0 ? <li className="text-muted-foreground">—</li> : null}
            {d.tickets.map((x) => (
              <li key={x.id} dir="auto">
                <span className="font-mono">{x.reference}</span> {x.summary}{" "}
                <Badge>{x.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle className="text-base">{t("messages")}</CardTitle>
          <ul className="mt-2 space-y-1 text-sm">
            {d.messages.length === 0 ? <li className="text-muted-foreground">—</li> : null}
            {d.messages.map((m) => (
              <li key={m.id} dir="auto">
                <span className="font-mono">{m.reference}</span> {m.reason}{" "}
                <Badge>{m.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
