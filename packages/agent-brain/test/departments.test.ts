import { describe, expect, it } from "vitest";
import {
  chatMenuText,
  departmentChosenPhrase,
  departmentsPromptSegment,
  digitChoice,
  menuActive,
  menuLine,
  personRequestText,
  type DepartmentInfo,
  type MenuSettings,
} from "../src/departments";
import { startConversation } from "../src/engine";
import { LANGUAGES } from "../src/languages";
import { greeting } from "../src/phrases";
import { buildSystemPrompt } from "../src/prompt";
import { InMemoryAgentServices } from "../src/services";
import { initialState, stepNote } from "../src/state";
import { runTool } from "../src/tools";
import { makeContext } from "./fixtures";

const dept = (key: number, name: string, extra: Partial<DepartmentInfo> = {}): DepartmentInfo => ({
  id: `d-${key}`,
  key,
  name,
  spokenNames: {},
  instructions: null,
  routing: "people_then_phone",
  transferPhone: null,
  notifyEmail: null,
  paymentLink: null,
  ringFirst: false,
  ...extra,
});

const MENU: MenuSettings = {
  enabled: true,
  hours: "always",
  onChat: true,
  departments: [
    dept(1, "Sales"),
    dept(2, "Support", { instructions: "Ask for the order number first." }),
    dept(4, "Payments", { paymentLink: "https://buy.stripe.com/x", spokenNames: { es: "Pagos" } }),
  ],
};

describe("the phone menu", () => {
  it("is spoken in every language, with spoken names per language", () => {
    expect(menuLine("en", MENU.departments)).toBe(
      "For Sales, press 1. For Support, press 2. For Payments, press 4. Or just tell me what you need.",
    );
    expect(menuLine("es", MENU.departments)).toContain("Para Pagos, pulse 4");
    for (const lang of LANGUAGES) {
      expect(menuLine(lang, MENU.departments)).toMatch(/4/);
      expect(chatMenuText(lang, MENU.departments).split("\n")).toHaveLength(4);
      expect(departmentChosenPhrase(lang, MENU.departments[1]!)).toContain("Support");
      expect(personRequestText(lang).length).toBeGreaterThan(5);
    }
  });

  it("always comes after the AI disclosure, in place of the question", () => {
    const ctx = makeContext({ style: "voice", menu: MENU });
    for (const lang of LANGUAGES) {
      const plain = greeting(lang, { business: "Bright Dental", name: "Amelia", gender: "female" });
      const withMenu = startConversation(ctx, { language: lang, menu: "voice" }).greeting;
      const menu = menuLine(lang, MENU.departments);
      expect(withMenu.endsWith(menu)).toBe(true);
      // The greeting up to the question is unchanged: the disclosure is always first.
      const intro = withMenu.slice(0, withMenu.length - menu.length).trim();
      expect(plain.startsWith(intro)).toBe(true);
      expect(intro.length).toBeGreaterThan(20);
    }
    // Without a menu, the greeting is exactly as before.
    expect(startConversation(ctx, { language: "en" }).greeting).toBe(
      greeting("en", { business: "Bright Dental", name: "Amelia", gender: "female" }),
    );
  });

  it("missed calls hear that the team couldn't answer, after the disclosure", () => {
    const ctx = makeContext({ style: "voice" });
    const { greeting: text, state } = startConversation(ctx, {
      language: "en",
      entry: "forwarded",
    });
    expect(text).toBe(
      "Hello, you're through to Bright Dental. I'm Amelia, the AI assistant here. The team couldn't get to the phone just now, but I can book you in, arrange a call back or take a message. How can I help you today?",
    );
    expect(state.entry).toBe("forwarded");
    expect(stepNote({ ...state, turns: 1 }, "Mon 10:00")).toMatch(/nobody could answer/);
  });

  it("reads keypad-style replies and respects opening hours", () => {
    expect(digitChoice("2")).toBe(2);
    expect(digitChoice(" 3. ")).toBe(3);
    expect(digitChoice("22")).toBeNull();
    expect(digitChoice("2 please")).toBeNull();
    expect(menuActive(MENU, null, "Europe/London", new Date())).toBe(true);
    expect(menuActive({ ...MENU, enabled: false }, null, "Europe/London", new Date())).toBe(false);
  });
});

describe("departments in the conversation", () => {
  it("are in the stable part of the prompt, with the business's instructions", () => {
    const prompt = buildSystemPrompt(makeContext({ menu: MENU })).join("\n");
    expect(prompt).toContain(
      "2. Support (instructions from the business: Ask for the order number first.)",
    );
    expect(prompt).toContain("send_payment_link");
    expect(prompt).toMatch(/Never take card details/);
    expect(departmentsPromptSegment([])).toBe("");
  });

  it("set_department moves the conversation and records how", async () => {
    const services = new InMemoryAgentServices();
    const ctx = makeContext({ menu: MENU });
    const state = initialState("en");
    const first = await runTool("set_department", { key: 2 }, { ctx, services, state });
    expect(first.isError).toBeFalsy();
    expect(state.department).toEqual({ id: "d-2", key: 2, name: "Support" });
    expect(stepNote(state, "Mon 10:00")).toContain("Current department: 2. Support.");
    await runTool("set_department", { key: 4 }, { ctx, services, state });
    expect(services.departmentChoices).toEqual([
      { departmentId: "d-2", via: "speech" },
      { departmentId: "d-4", via: "assistant" },
    ]);
    const missing = await runTool("set_department", { key: 7 }, { ctx, services, state });
    expect(missing.isError).toBe(true);
  });

  it("send_payment_link sends the department's link, never without one", async () => {
    const services = new InMemoryAgentServices();
    const ctx = makeContext({ menu: MENU });
    const state = initialState("en", "+447700900123");
    // Support has no link.
    state.department = { id: "d-2", key: 2, name: "Support" };
    const none = await runTool("send_payment_link", { channel: "sms" }, { ctx, services, state });
    expect(none.isError).toBe(true);
    state.department = { id: "d-4", key: 4, name: "Payments" };
    const sms = await runTool("send_payment_link", { channel: "sms" }, { ctx, services, state });
    expect(sms.isError).toBeFalsy();
    expect(sms.result.next).toMatch(/Never ask for or repeat card details/);
    const email = await runTool(
      "send_payment_link",
      { channel: "email", to: "pat@example.com" },
      { ctx, services, state },
    );
    expect(email.isError).toBeFalsy();
    expect(services.paymentLinks).toEqual([
      { departmentId: "d-4", channel: "sms", to: "+447700900123", language: "en" },
      { departmentId: "d-4", channel: "email", to: "pat@example.com", language: "en" },
    ]);
    const noAddress = await runTool(
      "send_payment_link",
      { channel: "email" },
      { ctx, services, state },
    );
    expect(noAddress.isError).toBe(true);
  });
});
