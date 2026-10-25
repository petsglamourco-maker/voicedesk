import { getPlanState, planAllows } from "@voicedesk/core";
import {
  agentSettings,
  conversations,
  departmentMoves,
  departments,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, asc, eq } from "drizzle-orm";
import type { Lang } from "./languages";
import type { BusinessProfile } from "./profile";
import { isOpenNow } from "./transfer";
import { neutraliseMarkers } from "./untrusted";

/**
 * Departments and the phone menu (ADR 0025): "press 1 for Sales, 2 for Support…". The menu
 * is spoken after the greeting (the AI disclosure always comes first). A keypad press picks
 * a department without the AI; speech goes through the assistant's set_department tool.
 */

export type DepartmentRouting = "people_then_phone" | "people_only" | "phone_only" | "message_only";

export interface DepartmentInfo {
  id: string;
  key: number;
  name: string;
  spokenNames: Record<string, string>;
  instructions: string | null;
  routing: DepartmentRouting;
  transferPhone: string | null;
  notifyEmail: string | null;
  paymentLink: string | null;
  ringFirst: boolean;
}

export interface MenuSettings {
  /** Switched on, the plan includes it, and at least one department is enabled. */
  enabled: boolean;
  hours: "always" | "open";
  onChat: boolean;
  departments: DepartmentInfo[];
}

export const NO_MENU: MenuSettings = {
  enabled: false,
  hours: "always",
  onChat: false,
  departments: [],
};

export function toRouting(value: string | null | undefined): DepartmentRouting {
  return value === "people_only" || value === "phone_only" || value === "message_only"
    ? value
    : "people_then_phone";
}

/** The business's enabled departments and menu switches (empty without the plan feature). */
export async function loadMenu(db: Database, tenantId: string): Promise<MenuSettings> {
  const { rows, settings } = await withTenant(db, tenantId, async (tx) => ({
    rows: await tx
      .select()
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), eq(departments.enabled, true)))
      .orderBy(asc(departments.position), asc(departments.key)),
    settings: (
      await tx
        .select({
          menuEnabled: agentSettings.menuEnabled,
          menuHours: agentSettings.menuHours,
          menuOnChat: agentSettings.menuOnChat,
        })
        .from(agentSettings)
        .where(eq(agentSettings.tenantId, tenantId))
    )[0],
  }));
  if (rows.length === 0) return NO_MENU;
  const allowed = planAllows(await getPlanState(db, tenantId), "departments");
  return {
    enabled: allowed && (settings?.menuEnabled ?? false),
    hours: settings?.menuHours === "open" ? "open" : "always",
    onChat: allowed && (settings?.menuOnChat ?? false),
    departments: allowed
      ? rows.map((d) => ({
          id: d.id,
          key: d.key,
          name: d.name,
          spokenNames: d.spokenNames,
          instructions: d.instructions,
          routing: toRouting(d.routing),
          transferPhone: d.transferPhone,
          notifyEmail: d.notifyEmail,
          paymentLink: d.paymentLink,
          ringFirst: d.ringFirst,
        }))
      : [],
  };
}

/** Whether callers hear the menu now (out of hours it can be off: the AI answers directly). */
export function menuActive(
  menu: MenuSettings | undefined,
  profile: BusinessProfile | null,
  timeZone: string,
  now: Date,
): boolean {
  if (!menu?.enabled || menu.departments.length === 0) return false;
  return menu.hours === "always" || isOpenNow(profile, timeZone, now);
}

const spoken = (d: DepartmentInfo, lang: Lang) => d.spokenNames[lang]?.trim() || d.name;

const MENU: Record<
  Lang,
  { item: (name: string, key: number) => string; join: string; end: string }
> = {
  en: {
    item: (n, k) => `For ${n}, press ${k}`,
    join: ". ",
    end: ". Or just tell me what you need.",
  },
  es: {
    item: (n, k) => `Para ${n}, pulse ${k}`,
    join: ". ",
    end: ". O simplemente dígame qué necesita.",
  },
  fr: {
    item: (n, k) => `Pour ${n}, tapez ${k}`,
    join: ". ",
    end: ". Ou dites-moi simplement ce dont vous avez besoin.",
  },
  de: {
    item: (n, k) => `Für ${n} drücken Sie die ${k}`,
    join: ". ",
    end: ". Oder sagen Sie mir einfach, worum es geht.",
  },
  zh: { item: (n, k) => `${n}请按${k}`, join: "，", end: "。或者直接告诉我您需要什么。" },
  ar: { item: (n, k) => `لـ${n} اضغط ${k}`, join: "، ", end: ". أو أخبرني ببساطة بما تحتاجه." },
};

/** The spoken menu line, e.g. "For Sales, press 1. For Support, press 2. Or just tell me…" */
export function menuLine(lang: Lang, list: DepartmentInfo[]): string {
  const m = MENU[lang];
  return list.map((d) => m.item(spoken(d, lang), d.key)).join(m.join) + m.end;
}

const CHAT_MENU: Record<Lang, { intro: string; item: (name: string, key: number) => string }> = {
  en: { intro: "Reply with a number, or just tell me what you need:", item: (n, k) => `${k} ${n}` },
  es: { intro: "Responda con un número o dígame qué necesita:", item: (n, k) => `${k} ${n}` },
  fr: {
    intro: "Répondez avec un chiffre, ou dites-moi ce dont vous avez besoin :",
    item: (n, k) => `${k} ${n}`,
  },
  de: {
    intro: "Antworten Sie mit einer Zahl oder sagen Sie mir, worum es geht:",
    item: (n, k) => `${k} ${n}`,
  },
  zh: { intro: "请回复数字，或直接告诉我您需要什么：", item: (n, k) => `${k} ${n}` },
  ar: { intro: "أرسل رقماً، أو أخبرني بما تحتاجه:", item: (n, k) => `${k} ${n}` },
};

/** WhatsApp and other text channels: a numbered list after the greeting. */
export function chatMenuText(lang: Lang, list: DepartmentInfo[]): string {
  const m = CHAT_MENU[lang];
  return [m.intro, ...list.map((d) => m.item(spoken(d, lang), d.key))].join("\n");
}

export function departmentByKey(
  menu: MenuSettings | undefined,
  key: number,
): DepartmentInfo | null {
  return menu?.departments.find((d) => d.key === key) ?? null;
}

/** A text reply that is only a menu number ("2", " 2 ", "2."). */
export function digitChoice(text: string): number | null {
  const match = /^\s*([0-9])\s*[.)]?\s*$/.exec(text);
  return match ? Number(match[1]) : null;
}

/** Engine note when a department is chosen: the business's own instructions for it. */
export function departmentNote(d: DepartmentInfo, via: string): string {
  const how = via === "assistant" ? "You moved the conversation to" : "The caller chose";
  const parts = [`${how} the ${d.name} department.`];
  if (d.instructions?.trim()) {
    parts.push(
      `The business's instructions for ${d.name}: ${neutraliseMarkers(d.instructions.trim())}`,
    );
  }
  if (d.paymentLink) {
    parts.push(
      "This department can send the business's secure payment link (send_payment_link). Never take card details over the phone or in chat.",
    );
  }
  return parts.join(" ");
}

/** Engine note at the start: the departments the assistant can pick with set_department. */
export function departmentsListNote(list: DepartmentInfo[]): string {
  const items = list.map((d) => `${d.key} = ${d.name}`).join(", ");
  return `This business has departments (${items}). When it's clear which one the customer needs, call set_department with its number; you can change it later if the topic changes.`;
}

/** Saves the conversation's department and the move (append-only history). */
export async function recordDepartmentChoice(
  db: Database,
  params: { tenantId: string; conversationId: string; departmentId: string | null; via: string },
): Promise<void> {
  await withTenant(db, params.tenantId, async (tx) => {
    await tx
      .update(conversations)
      .set({ departmentId: params.departmentId })
      .where(eq(conversations.id, params.conversationId));
    await tx.insert(departmentMoves).values({
      tenantId: params.tenantId,
      conversationId: params.conversationId,
      departmentId: params.departmentId,
      via: params.via,
    });
  });
}
