import { MockEmbeddingProvider, MockLlmProvider } from "@voicedesk/adapters";
import { agentSettings, closeDb, withTenant } from "@voicedesk/db";
import { connectTestDbs, createTestTenant, type TestDbs } from "@voicedesk/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConversationDriver } from "../src/driver";
import { createConversation } from "../src/persistence";
import { InMemoryAgentServices } from "../src/services";
import { createDbAgentServices, type AgentNotification } from "../src/services-db";
import { isOpenNow, transferTarget, type TransferSettings } from "../src/transfer";
import { makeContext, PROFILE } from "./fixtures";

const S = (over: Partial<TransferSettings> = {}): TransferSettings => ({
  transferPhone: "+447700900111",
  transferHours: "open",
  onCallPhone: "+447700900222",
  ...over,
});

describe("transferTarget", () => {
  it.each([
    ["open, normal", S(), true, false, "+447700900111"],
    ["closed, normal", S(), false, false, null],
    ["closed, urgent → on call", S(), false, true, "+447700900222"],
    ["closed, 'always' line", S({ transferHours: "always" }), false, false, "+447700900111"],
    ["no transfer line, urgent", S({ transferPhone: null }), true, true, "+447700900222"],
    ["no transfer line, normal", S({ transferPhone: null }), true, false, null],
    ["nothing set", S({ transferPhone: null, onCallPhone: null }), true, true, null],
  ])("%s", (_name, settings, open, urgent, expected) => {
    expect(transferTarget(settings, open, urgent)).toBe(expected);
  });
});

describe("isOpenNow", () => {
  // Bright Dental fixture: Mon–Fri 09:00–17:00 (Thu to 20:00), weekends closed. London = UTC+1.
  it.each([
    ["2026-10-19T08:30:00Z", true], // Mon 09:30
    ["2026-10-19T07:59:00Z", false], // Mon 08:59
    ["2026-10-19T16:00:00Z", false], // Mon 17:00 (closing time)
    ["2026-10-22T18:30:00Z", true], // Thu 19:30
    ["2026-10-24T10:00:00Z", false], // Saturday
  ])("%s → %s", (iso, expected) => {
    expect(isOpenNow(PROFILE, "Europe/London", new Date(iso))).toBe(expected);
  });
});

describe("request_human on a phone call", () => {
  it("puts the caller through and clears the instruction on the next turn", async () => {
    const services = new InMemoryAgentServices();
    services.transferTo = "+447700900111";
    const llm = new MockLlmProvider().enqueue(
      MockLlmProvider.toolUse("request_human", { reason: "Wants the manager" }),
      MockLlmProvider.text("I'll put you through now."),
      MockLlmProvider.text("Sure, how can I help?"),
    );
    const driver = new ConversationDriver({ llm, services }, makeContext({ style: "voice" }));
    driver.start();
    const turn = await driver.say("Can I speak to the manager please?");
    expect(turn.state.transfer).toEqual({ to: "+447700900111" });
    const next = await driver.say("Hello?");
    expect(next.state.transfer).toBeUndefined();
  });
});

describe("transfer decision in the database services", () => {
  let dbs: TestDbs;
  let tenantId: string;
  beforeAll(async () => {
    dbs = connectTestDbs();
    tenantId = await createTestTenant(dbs.app, "Transfer Co");
    await withTenant(dbs.app, tenantId, (tx) =>
      tx.insert(agentSettings).values({
        tenantId,
        transferPhone: "+447700900111",
        transferHours: "always",
        onCallPhone: "+447700900222",
      }),
    );
  });
  afterAll(async () => {
    await closeDb(dbs.app);
    await closeDb(dbs.owner);
  });

  async function services(canTransfer: boolean, events: AgentNotification[]) {
    const { conversationId } = await createConversation(dbs.app, makeContext({ style: "voice" }), {
      tenantId,
      channel: "voice",
    });
    return createDbAgentServices(
      {
        db: dbs.app,
        embeddings: new MockEmbeddingProvider(),
        notify: (e) => Promise.resolve(void events.push(e)),
      },
      { tenantId, conversationId, businessName: "Transfer Co", canTransfer },
    );
  }

  it("transfers phone calls and sends the person answering some context", async () => {
    const events: AgentNotification[] = [];
    const res = await (await services(true, events)).requestHuman("Billing question");
    expect(res).toMatchObject({ available: true, transferTo: "+447700900111" });
    expect(events).toEqual([
      expect.objectContaining({
        kind: "transfer.context",
        to: "+447700900111",
        reason: "Billing question",
      }),
    ]);
  });

  it("never transfers chats or browser tests", async () => {
    const events: AgentNotification[] = [];
    const res = await (await services(false, events)).requestHuman("Billing question");
    expect(res.available).toBe(false);
    expect(events).toEqual([]);
  });
});
