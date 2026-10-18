import { channelThreads, contacts, conversations, withTenant } from "@voicedesk/db";
import { and, eq, isNull } from "drizzle-orm";
import { handleInboundMessage, type ChannelTurnDeps } from "./channels";
import type { EmailThreadMeta } from "./email";
import { loadAgentContext } from "./services-db";
import { normalisePhone } from "./util";

/**
 * Form capture (Phase 4): a submission from the hosted enquiry form or a business's existing
 * form (webhook) becomes a contact and a thread. The assistant triages it like an email:
 * records what's needed and drafts a reply that a person approves (sent by email when the
 * person left an address and agreed to be contacted).
 */

export interface FormSubmission {
  submissionId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string;
  /** Other fields from the form, shown to the assistant and staff as they are. */
  extra: Record<string, string>;
  /** The person agreed to be contacted about this enquiry. */
  contactConsent: boolean;
  marketingConsent: boolean;
  source: "hosted" | "webhook";
}

export async function processFormSubmission(
  deps: ChannelTurnDeps,
  tenantId: string,
  form: FormSubmission,
): Promise<{ threadId: string; conversationId: string }> {
  const { countryCode } = await loadAgentContext(deps.db, tenantId, "email");
  const phone = form.phone ? normalisePhone(form.phone, countryCode) : null;
  const email = form.email?.trim().toLowerCase() || null;
  const lines = [
    "New enquiry from the website form.",
    `Name: ${form.name ?? "(not given)"}`,
    `Email: ${email ?? "(not given)"}`,
    `Phone: ${form.phone ?? "(not given)"}`,
    ...Object.entries(form.extra).map(([k, v]) => `${k}: ${v}`),
    "",
    form.message || "(no message)",
  ];
  const canEmail = email !== null && form.contactConsent;
  const meta: Partial<EmailThreadMeta> & Record<string, unknown> = {
    source: form.source,
    contactConsent: form.contactConsent,
    marketingConsent: form.marketingConsent,
    ...(canEmail
      ? { replyTo: email, subject: "Your enquiry", lastMessageId: null, references: [] }
      : {}),
  };
  const result = await handleInboundMessage(
    deps,
    {
      tenantId,
      channel: "web_form",
      externalId: `form-${form.submissionId}`,
      phone,
      displayName: form.name ?? email ?? phone,
      subject: form.message.slice(0, 80) || "Form enquiry",
      meta,
    },
    lines.join("\n"),
    { draft: true },
  );
  if (email || phone) {
    await linkFormContact(deps.db, tenantId, result, { email, phone, name: form.name });
  }
  return { threadId: result.threadId, conversationId: result.conversationId };
}

/**
 * Links the person to a contact: the one already recognised by phone (adding the email), one
 * with the same email or phone, or a new one.
 */
async function linkFormContact(
  db: ChannelTurnDeps["db"],
  tenantId: string,
  ids: { threadId: string; conversationId: string },
  who: { email: string | null; phone: string | null; name: string | null },
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    const [conv] = await tx
      .select({ contactId: conversations.contactId })
      .from(conversations)
      .where(eq(conversations.id, ids.conversationId));
    const byField = async (field: "email" | "phone") => {
      const value = who[field];
      if (!value) return undefined;
      const column = field === "email" ? contacts.email : contacts.phoneE164;
      const [found] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenantId), eq(column, value)));
      return found?.id;
    };
    const contactId =
      conv?.contactId ??
      (await byField("email")) ??
      (await byField("phone")) ??
      (
        await tx
          .insert(contacts)
          .values({
            tenantId,
            email: who.email,
            phoneE164: who.phone,
            fullName: who.name,
            source: "web_form",
          })
          .returning({ id: contacts.id })
      )[0]!.id;
    // Fill in what the contact didn't have yet; never overwrite.
    if (who.email) {
      await tx
        .update(contacts)
        .set({ email: who.email })
        .where(and(eq(contacts.id, contactId), isNull(contacts.email)));
    }
    const phoneOwner = await byField("phone");
    if (who.phone && (!phoneOwner || phoneOwner === contactId)) {
      await tx
        .update(contacts)
        .set({ phoneE164: who.phone })
        .where(and(eq(contacts.id, contactId), isNull(contacts.phoneE164)));
    }
    await tx
      .update(conversations)
      .set({ contactId })
      .where(eq(conversations.id, ids.conversationId));
    await tx.update(channelThreads).set({ contactId }).where(eq(channelThreads.id, ids.threadId));
  });
}
