import { MockLlmProvider } from "@voicedesk/adapters";
import type { Database } from "@voicedesk/db";
import { describe, expect, it } from "vitest";
import { askHelp, helpFromSearch, type HelpSearchHit, type HelpUser } from "../src/help";

const who: HelpUser = {
  tenantId: "t1",
  userId: "u1",
  role: "staff",
  businessName: "Bright Dental",
  page: "/t/:tenant/integrations",
};
const db = {} as Database; // the mock model's usage isn't recorded

const hit: HelpSearchHit = {
  title: "Connect your calendar - Google or Outlook",
  heading: "Connect Google Calendar",
  page: "/t/:tenant/integrations",
  text: "1. Open Integrations. 2. Click **Connect Google Calendar**.",
};

describe("askHelp", () => {
  it("looks things up, checks the setup and answers with the screen link", async () => {
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("search_help", { query: "connect google calendar" }),
      MockLlmProvider.toolUse("get_my_setup", {}),
      MockLlmProvider.text(
        "Your calendar isn't connected yet. Open [Integrations](/t/:tenant/integrations).",
      ),
    );
    const queries: string[] = [];
    const answer = await askHelp(
      {
        db,
        llm,
        search: (q) => {
          queries.push(q);
          return Promise.resolve([hit]);
        },
        setup: () => Promise.resolve({ calendarConnected: false }),
      },
      who,
      "How do I get bookings into Google Calendar?",
    );
    expect(queries).toEqual(["connect google calendar"]);
    expect(answer).toMatchObject({
      offerSupport: false,
      used: ["search_help", "get_my_setup"],
      sources: [{ title: hit.title, page: hit.page }],
    });
    expect(answer.answer).toContain("/t/:tenant/integrations");

    // The page and role go in a note on the question; the system prompt stays stable.
    const first = llm.requests[0]!;
    expect(JSON.stringify(first.messages.at(-1)!.content)).toContain("screen: /t/:tenant/integrations");
    expect(JSON.stringify(first.messages.at(-1)!.content)).toContain("role: staff");
    expect(first.system.join("\n")).not.toMatch(/Asked on screen|Their role/);
    expect(first.tier).toBe("realtime");
    // Tool results reach the model.
    expect(JSON.stringify(llm.requests[1]!.messages)).toContain("Connect Google Calendar");
    expect(JSON.stringify(llm.requests[2]!.messages)).toContain("calendarConnected");
  });

  it("can't read the setup when there's no business", async () => {
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("get_my_setup", {}),
      MockLlmProvider.text("I can't see a business here."),
    );
    const answer = await askHelp({ db, llm, search: () => Promise.resolve([]) }, who, "Why?");
    expect(llm.requests[0]!.tools?.map((t) => t.name)).toEqual(["search_help", "offer_support"]);
    expect(JSON.stringify(llm.requests[1]!.messages)).toContain("No business is open");
    expect(answer.answer).toBe("I can't see a business here.");
  });

  it("offers support when asked to", async () => {
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("offer_support", { reason: "possible bug" }),
      MockLlmProvider.text("That sounds like a bug. Use **Contact support** below."),
    );
    const answer = await askHelp(
      { db, llm, search: () => Promise.resolve([]) },
      who,
      "The page crashed",
    );
    expect(answer.offerSupport).toBe(true);
  });

  it("stops after a few rounds and answers without tools", async () => {
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("search_help", { query: "a b" }),
      MockLlmProvider.toolUse("search_help", { query: "c d" }),
      MockLlmProvider.toolUse("search_help", { query: "e f" }),
      MockLlmProvider.text("Here's what I found."),
    );
    const answer = await askHelp({ db, llm, search: () => Promise.resolve([hit]) }, who, "Help");
    expect(llm.requests).toHaveLength(4);
    expect(llm.requests[3]!.tools).toBeUndefined();
    expect(answer.answer).toBe("Here's what I found.");
  });

  it("streams text when asked", async () => {
    const llm = new MockLlmProvider().enqueue(MockLlmProvider.text("Hello there"));
    let streamed = "";
    await askHelp({ db, llm, search: () => Promise.resolve([]) }, who, "Hi", [], (d) => {
      streamed += d;
    });
    expect(streamed).toBe("Hello there");
  });
});

describe("helpFromSearch (no AI provider)", () => {
  it("shows the best sections with links", () => {
    const answer = helpFromSearch([hit]);
    expect(answer.answer).toContain("Connect Google Calendar");
    expect(answer.answer).toContain("(/t/:tenant/integrations)");
    expect(answer.offerSupport).toBe(false);
  });

  it("offers support when nothing matches", () => {
    expect(helpFromSearch([]).offerSupport).toBe(true);
  });
});
