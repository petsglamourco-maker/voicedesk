import { MockLlmProvider, ProviderError, type LlmProvider } from "@voicedesk/adapters";
import { describe, expect, it } from "vitest";
import { findSlots } from "../src/availability";
import { ConversationDriver } from "../src/driver";
import { LANGUAGES } from "../src/languages";
import { greeting } from "../src/phrases";
import { InMemoryAgentServices } from "../src/services";
import { toolDefinitions } from "../src/tools";
import { makeContext, NOW, PROFILE } from "./fixtures";

const text = (t: string) => MockLlmProvider.text(t);
const toolUse = (name: string, input: unknown) => MockLlmProvider.toolUse(name, input);

function setup(llm: LlmProvider = new MockLlmProvider(), ctx = makeContext()) {
  const services = new InMemoryAgentServices([
    {
      title: "Parking",
      content: "There is a pay and display car park on Pratt Street, two minutes away.",
    },
  ]);
  const driver = new ConversationDriver({ llm, services }, ctx);
  return { driver, services };
}

describe("greeting and disclosure", () => {
  it.each(LANGUAGES)("discloses AI identity in %s", (lang) => {
    const g = greeting(lang, { business: "Bright Dental", name: "Amelia", gender: "female" });
    expect(g).toContain("Amelia");
    expect(g).toContain("Bright Dental");
    expect(g).toMatch(/\bAI\b|inteligencia artificial|\bIA\b|KI-|人工智能|الذكاء الاصطناعي/);
  });

  it("starts the transcript with the greeting", () => {
    const { driver } = setup();
    expect(driver.start({ language: "fr" })).toMatch(/Bonjour.*Amelia.*IA/);
    expect(driver.state.history[0]).toMatchObject({ role: "user" });
  });
});

describe("safeguards", () => {
  it("answers life-threatening emergencies immediately without the LLM", async () => {
    const llm = new MockLlmProvider();
    const { driver } = setup(llm);
    driver.start();
    const turn = await driver.say("Please help, my husband is having a heart attack");
    expect(turn.reply).toContain("999");
    expect(turn.state.flow).toBe("emergency");
    expect(llm.requests).toHaveLength(0);
  });

  it("degrades gracefully when the LLM provider fails", async () => {
    const failing: LlmProvider = {
      name: "failing",
      complete: () => Promise.reject(new ProviderError("x", "down", { retryable: true })),
      stream: () => Promise.reject(new ProviderError("x", "down", { retryable: true })),
    };
    const { driver } = setup(failing);
    driver.start();
    const turn = await driver.say("Hello, what are your hours?");
    expect(turn.reply).toMatch(/technical problem/);
    expect(turn.events).toContainEqual(expect.objectContaining({ type: "fallback" }));
  });

  it("rejects invalid tool input and unknown tools", async () => {
    const llm = new MockLlmProvider().enqueue(
      toolUse("set_intent", { intent: "teleport" }),
      toolUse("delete_everything", {}),
      text("Sorry, how can I help?"),
    );
    const { driver } = setup(llm);
    driver.start();
    const turn = await driver.say("hi");
    const tools = turn.events.filter((e) => e.type === "tool");
    expect(tools.map((t) => t.type === "tool" && t.ok)).toEqual([false, false]);
  });
});

describe("prompt and caching", () => {
  it("keeps the system prompt and tools identical across turns, with a step note per turn", async () => {
    const llm = new MockLlmProvider();
    const { driver } = setup(llm);
    driver.start();
    await driver.say("What time do you open?");
    await driver.say("And on Saturday?");
    const [a, b] = llm.requests;
    expect(a!.system).toEqual(b!.system);
    expect(a!.tools).toEqual(b!.tools);
    expect(a!.system.join("\n")).toContain(
      "Check-up: Routine dental examination (price £45, 30 min, bookable)",
    );
    expect(a!.system.join("\n")).toMatch(/Never claim or imply that you are human/);
    const msgs = b!.messages;
    expect(msgs.at(-1)).toMatchObject({ role: "system" });
    expect(msgs.at(-1)!.content as string).toMatch(/\[Engine note/);
    expect(msgs.at(-2)).toMatchObject({ role: "user", content: "And on Saturday?" });
  });

  it("tells the model when no profile is approved", async () => {
    const llm = new MockLlmProvider();
    const { driver } = setup(llm, makeContext({ profile: null }));
    driver.start();
    await driver.say("How much is a check-up?");
    expect(llm.requests[0]!.system.join("\n")).toMatch(/not approved yet/);
  });

  it("exposes every tool with an object schema", () => {
    const tools = toolDefinitions();
    expect(tools.map((t) => t.name)).toContain("create_ticket");
    for (const t of tools) expect(t.inputSchema).toMatchObject({ type: "object" });
  });
});

describe("language", () => {
  it("switches language from what the caller writes", async () => {
    const { driver } = setup();
    driver.start();
    const turn = await driver.say(
      "Hola, quiero saber si tienen una cita para el lunes con el dentista",
    );
    expect(turn.state.language).toBe("es");
    expect(turn.events).toContainEqual({ type: "language", language: "es" });
  });

  it("switches language when the model calls set_language", async () => {
    const llm = new MockLlmProvider().enqueue(
      toolUse("set_language", { language: "zh" }),
      text("好的。"),
    );
    const { driver } = setup(llm);
    driver.start();
    const turn = await driver.say("Can we speak Mandarin?");
    expect(turn.state.language).toBe("zh");
  });
});

describe("ending", () => {
  it("records that the agent closed the conversation", async () => {
    const llm = new MockLlmProvider().enqueue(
      toolUse("end_conversation", {}),
      text("Thanks for calling, goodbye!"),
    );
    const { driver } = setup(llm);
    driver.start();
    const turn = await driver.say("That's all, thanks. Bye!");
    expect(turn.state.endRequested).toBe(true);
    expect(turn.reply).toMatch(/goodbye/i);
  });
});

describe("ending without repeating the goodbye", () => {
  it("stops after end_conversation when the goodbye was already said", async () => {
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("end_conversation", {}, "Thanks for calling, goodbye!"),
      text("Goodbye again!"),
    );
    const { driver } = setup(llm);
    driver.start();
    const turn = await driver.say("That's all, bye.");
    expect(turn.reply).toBe("Thanks for calling, goodbye!");
    expect(llm.requests).toHaveLength(1);
  });
});

describe("complaint flow", () => {
  it("refuses to create a ticket until the complaint details are captured", async () => {
    const llm = new MockLlmProvider();
    const { driver, services } = setup(llm);
    driver.start();
    llm.enqueue(
      toolUse("set_intent", { intent: "complaint" }),
      toolUse("update_complaint", {
        callerName: "Sam Patel",
        issue: "Filling fell out two days after treatment",
        sentiment: "frustrated",
      }),
      toolUse("create_ticket", { summary: "Filling fell out", callerConfirmedSummary: true }),
      text("I'm sorry to hear that. When did it first happen?"),
    );
    const first = await driver.say("I want to complain, my filling fell out. I'm Sam Patel.");
    const attempt = first.events.find((e) => e.type === "tool" && e.name === "create_ticket");
    expect(attempt).toMatchObject({ ok: false });
    expect(JSON.stringify(attempt)).toContain("startedWhen");
    // No callback was requested, so no callback details are required.
    expect(JSON.stringify(attempt)).not.toContain("callbackPhone");
    expect(services.tickets).toHaveLength(0);

    llm.enqueue(
      toolUse("update_complaint", {
        startedWhen: "Saturday",
        impact: "Pain when eating",
        severity: "high",
        preferredOutcome: "Have it re-done free of charge",
      }),
      toolUse("create_ticket", {
        summary: "Filling fell out after treatment; pain when eating; wants free re-treatment.",
        callerConfirmedSummary: true,
      }),
      text("I've logged that for the practice. Your reference is T S, 2 2 2 1."),
    );
    const second = await driver.say(
      "Since Saturday, it hurts to eat, I'd like it redone for free.",
    );
    expect(services.tickets).toHaveLength(1);
    expect(services.tickets[0]).toMatchObject({ priority: "high" });
    expect(second.events).toContainEqual(expect.objectContaining({ type: "record" }));
  });

  it("collects confirmed callback details only when the customer asks for a callback", async () => {
    const llm = new MockLlmProvider();
    const { driver, services } = setup(llm);
    driver.start({ callerPhone: "+447700900123" });
    llm.enqueue(
      toolUse("set_intent", { intent: "complaint" }),
      toolUse("update_complaint", {
        callerName: "Sam",
        issue: "Late appointment",
        startedWhen: "today",
        impact: "missed work",
        severity: "medium",
        preferredOutcome: "an apology",
        wantsCallback: true,
        callbackPhone: "07700 900123",
      }),
      toolUse("create_ticket", { summary: "Late appointment", callerConfirmedSummary: true }),
      text("Is 07700 900 123 the best number?"),
    );
    const turn = await driver.say("Please have the manager call me back");
    const attempt = turn.events.find((e) => e.type === "tool" && e.name === "create_ticket");
    expect(JSON.stringify(attempt)).toContain("phoneConfirmed");
    expect(JSON.stringify(attempt)).toContain("callbackTime");
    expect(services.tickets).toHaveLength(0);
  });

  it("rejects invalid phone numbers", async () => {
    const llm = new MockLlmProvider().enqueue(
      toolUse("update_complaint", { callbackPhone: "12" }),
      text("Could you repeat that number?"),
    );
    const { driver } = setup(llm);
    driver.start();
    const turn = await driver.say("my number is 12");
    expect(turn.events[0]).toMatchObject({ type: "tool", ok: false });
  });
});

describe("booking flow", () => {
  it("finds slots inside opening hours with minimum notice", () => {
    const result = findSlots({
      profile: PROFILE,
      timeZone: "Europe/London",
      date: "2026-10-19",
      serviceName: "check-up",
      busy: [],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 09:00 local now + 2h notice → first slot 11:00 local = 10:00Z; last start 16:30 local.
    expect(result.slots[0]!.startsAt).toBe("2026-10-19T10:00:00.000Z");
    expect(result.slots.at(-1)!.startsAt).toBe("2026-10-19T15:30:00.000Z");
    expect(result.slots).toHaveLength(3);
  });

  it("caps an impossible gap between bookings so one booking can't block a whole day", () => {
    const profile = { ...PROFILE, bookingRules: { ...PROFILE.bookingRules, bufferMinutes: 2000 } };
    const result = findSlots({
      profile,
      timeZone: "Europe/London",
      date: "2026-10-19",
      serviceName: "check-up",
      // One booking early in the day; a 2000-minute buffer would hide every other slot.
      busy: [
        { startsAt: new Date("2026-10-19T08:00:00Z"), endsAt: new Date("2026-10-19T08:30:00Z") },
      ],
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses closed days and non-bookable services", () => {
    const base = { profile: PROFILE, timeZone: "Europe/London", busy: [], now: NOW };
    expect(findSlots({ ...base, date: "2026-10-25", serviceName: "Check-up" })).toMatchObject({
      ok: false,
    });
    expect(findSlots({ ...base, date: "2026-10-20", serviceName: "Whitening" })).toMatchObject({
      ok: false,
    });
  });

  it("books a confirmed slot and prevents double booking", async () => {
    const llm = new MockLlmProvider();
    const { driver, services } = setup(llm);
    driver.start();
    llm.enqueue(
      toolUse("check_availability", {
        service: "Check-up",
        date: "2026-10-20",
        timeOfDay: "morning",
      }),
      text("I have 9:00, 10:15 or 11:30. Which suits you?"),
    );
    const t1 = await driver.say("Can I book a check-up tomorrow morning?");
    const slots = (
      t1.events.find((e) => e.type === "tool")! as {
        result: { slots: Array<{ startsAt: string }> };
      }
    ).result.slots;
    expect(slots.length).toBeGreaterThan(0);

    llm.enqueue(
      toolUse("update_booking", {
        startsAt: slots[0]!.startsAt,
        customerName: "Ana Lopez",
        phone: "07700 900456",
        phoneConfirmed: true,
      }),
      toolUse("create_booking", { callerConfirmed: true }),
      text("You're booked in."),
    );
    await driver.say("The first one. Ana Lopez, 07700 900456, yes that's right, please book it");
    expect(services.bookings).toHaveLength(1);
    expect(services.bookings[0]).toMatchObject({
      service: "Check-up",
      customerPhone: "+447700900456",
    });

    // A second conversation cannot take the same slot.
    const second = new ConversationDriver({ llm, services }, makeContext());
    second.start();
    llm.enqueue(
      toolUse("update_booking", { service: "Check-up", startsAt: slots[0]!.startsAt }),
      text("Taken."),
    );
    const clash = await second.say("Same slot please");
    expect(clash.events[0]).toMatchObject({ type: "tool", ok: false });
  });
});

describe("message and human flows", () => {
  it("takes a message once confirmed", async () => {
    const llm = new MockLlmProvider().enqueue(
      toolUse("update_message", {
        callerName: "Li Wei",
        callerPhone: "+447700900789",
        phoneConfirmed: true,
        reason: "Question about an invoice",
        urgency: "normal",
        bestTime: "After 3pm",
        forStaff: "Practice manager",
      }),
      toolUse("take_message", { callerConfirmed: true }),
      text("I'll pass that on."),
    );
    const { driver, services } = setup(llm);
    driver.start();
    await driver.say("Please ask the practice manager to call me about an invoice");
    expect(services.messages[0]).toMatchObject({
      callerName: "Li Wei",
      forStaff: "Practice manager",
    });
  });

  it("offers a message when no person is available", async () => {
    const llm = new MockLlmProvider().enqueue(
      toolUse("request_human", { reason: "Caller asked for a person" }),
      text("Nobody's free right now, can I take a message?"),
    );
    const { driver, services } = setup(llm);
    driver.start();
    const turn = await driver.say("Can I speak to a real person?");
    expect(services.humanRequests).toHaveLength(1);
    expect(turn.state.flow).toBe("message");
  });
});

describe("language fallback", () => {
  it("switches a Chinese or Arabic conversation to English for short Latin-script messages", async () => {
    const { driver } = setup();
    driver.start({ language: "ar" });
    const turn = await driver.say("My friend is not breathing");
    expect(turn.state.language).toBe("en");
    expect(turn.reply).toContain("hang up and call 999");
  });
});

describe("sign-ups and knowledge gaps", () => {
  it("signs up a new customer once details are confirmed", async () => {
    const llm = new MockLlmProvider().enqueue(
      toolUse("set_intent", { intent: "signup" }),
      toolUse("update_signup", {
        fullName: "Elis Jones",
        phone: "07412 344456",
        phoneConfirmed: true,
        interest: "Cybersecurity with AI",
        marketingConsent: false,
      }),
      toolUse("register_customer", { callerConfirmed: true }),
      text("You're signed up, Elis."),
    );
    const { driver, services } = setup(llm);
    driver.start();
    const turn = await driver.say(
      "Sign me up for the cybersecurity course. Elis Jones, 07412 344456, no marketing please.",
    );
    expect(services.signups[0]).toMatchObject({
      fullName: "Elis Jones",
      phone: "+447412344456",
      interest: "Cybersecurity with AI",
      marketingConsent: false,
    });
    expect(turn.state.records).toContainEqual(expect.objectContaining({ type: "signup" }));
  });

  it("refuses to register without contact details or a consent answer", async () => {
    const llm = new MockLlmProvider().enqueue(
      toolUse("update_signup", { fullName: "Elis", interest: "Data course" }),
      toolUse("register_customer", { callerConfirmed: true }),
      text("What's the best number for you?"),
    );
    const { driver, services } = setup(llm);
    driver.start();
    const turn = await driver.say("Sign me up");
    const attempt = turn.events.find((e) => e.type === "tool" && e.name === "register_customer");
    expect(JSON.stringify(attempt)).toContain("phone or email");
    expect(JSON.stringify(attempt)).toContain("marketingConsent");
    expect(services.signups).toHaveLength(0);
  });

  it("logs unanswered questions without pushing a callback", async () => {
    const llm = new MockLlmProvider().enqueue(
      toolUse("search_knowledge", { query: "children dentistry age" }),
      toolUse("note_unanswered_question", {
        question: "Do you treat children, and from what age?",
      }),
      text("I don't have details on children's treatment, but a check-up is £45."),
    );
    const { driver, services } = setup(llm);
    driver.start();
    await driver.say("Do you see children?");
    expect(services.knowledgeGaps).toEqual(["Do you treat children, and from what age?"]);
    expect(services.messages).toHaveLength(0);
  });

  it("puts the sales goal and callback-only-on-request rule in the prompt", async () => {
    const llm = new MockLlmProvider();
    const { driver } = setup(llm);
    driver.start();
    await driver.say("Hi");
    const system = llm.requests[0]!.system.join("\n");
    expect(system).toMatch(/only need to get involved when the customer asks/);
    expect(system).toMatch(/Main goal for enquiries: help the customer book an appointment/);
    expect(llm.requests[0]!.messages.at(-1)!.content as string).toMatch(
      /guide them to book an appointment/,
    );
  });
});
