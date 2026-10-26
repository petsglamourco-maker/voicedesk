import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts, tenants } from "./app";
import { bookings, conversations } from "./conversations";

/**
 * Follow-ups (ADR 0026): one friendly message the morning after an enquiry that didn't book,
 * only when the customer said yes in the conversation (PECR). Tenant data under forced RLS.
 */
export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** sms | email | whatsapp */
    channel: text("channel").notNull(),
    /** E.164 number or email address the customer confirmed (WhatsApp: their number). */
    to: text("to").notNull(),
    name: text("name"),
    /** What they asked about, short and cleaned (no links or numbers). */
    topic: text("topic").notNull(),
    language: text("language").notNull(),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    /** scheduled → sending → sent / skipped / cancelled */
    status: text("status").notNull().default("scheduled"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Why it was skipped or cancelled (e.g. "booked", "plan", "whatsapp_window"). */
    reason: text("reason"),
    /** A booking made within 7 days of the follow-up (attribution). */
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("follow_ups_conversation_uq").on(t.conversationId),
    index("follow_ups_due_idx").on(t.status, t.sendAt),
    index("follow_ups_tenant_sent_idx").on(t.tenantId, t.sentAt),
  ],
);
