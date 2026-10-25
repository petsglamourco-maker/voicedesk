import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, timestamps } from "./app";
import { user } from "./auth";
import { conversations } from "./conversations";

/**
 * Departments and the phone menu (ADR 0025): "press 1 for Sales, 2 for Support…". Each
 * department can have VoiceDesk staff, a phone number to transfer to and an email for its
 * messages, in any mix. Tenant data under forced RLS (custom migration).
 */
export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Keypad digit 1–9 (0 is always "a person"). */
    key: integer("key").notNull(),
    name: text("name").notNull(),
    /** Spoken name per language, e.g. { es: "Ventas" }; falls back to `name`. */
    spokenNames: jsonb("spoken_names").$type<Record<string, string>>().notNull().default({}),
    /** The business's instructions for the assistant in this department. */
    instructions: text("instructions"),
    /** people_then_phone | people_only | phone_only | message_only */
    routing: text("routing").notNull().default("people_then_phone"),
    /** E.164; checked against the allowed destinations when saved. */
    transferPhone: text("transfer_phone"),
    /** Messages, callbacks and call summaries for this department also go here. */
    notifyEmail: text("notify_email"),
    /** The business's own https payment link (Payments); never card details by voice. */
    paymentLink: text("payment_link"),
    /** Ring this department's people first; the assistant answers when nobody does. */
    ringFirst: boolean("ring_first").notNull().default(false),
    position: integer("position").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("departments_tenant_key_uq").on(t.tenantId, t.key)],
);

/** Staff who belong to a department (rung for its calls, sent its alerts). */
export const departmentMembers = pgTable(
  "department_members",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("department_members_uq").on(t.departmentId, t.userId)],
);

/** Each time a conversation's department was chosen or changed (append-only history). */
export const departmentMoves = pgTable(
  "department_moves",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "set null",
    }),
    /** "keypad" | "speech" | "chat" | "assistant" (moved by the AI mid-conversation). */
    via: text("via").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("department_moves_conversation_idx").on(t.conversationId)],
);
