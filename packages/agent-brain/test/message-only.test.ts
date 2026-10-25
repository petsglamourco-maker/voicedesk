import type { LlmProvider } from "@voicedesk/adapters";
import { describe, expect, it } from "vitest";
import { ConversationDriver } from "../src/driver";
import { InMemoryAgentServices } from "../src/services";
import { makeContext } from "./fixtures";

/** ADR 0022: with AI paused or capped, the engine takes messages and never calls a model. */
const noAi: LlmProvider = new Proxy({} as LlmProvider, {
  get: (_t, prop) => {
    if (prop === "then") return undefined;
    return () => {
      throw new Error(`the LLM must not be used (called ${String(prop)})`);
    };
  },
});

function setup(ctx = makeContext({ aiPaused: "cap" })) {
  const services = new InMemoryAgentServices([]);
  const driver = new ConversationDriver({ llm: noAi, services }, ctx);
  return { driver, services };
}

describe("take-a-message mode without AI", () => {
  it("asks for a name, number and message, then saves it", async () => {
    const { driver, services } = setup();
    driver.start();
    expect((await driver.say("Do you open on Saturdays?")).reply).toMatch(/take a message/);
    expect((await driver.say("Priya Shah")).reply).toMatch(/Priya.*phone number/);
    expect((await driver.say("not sure")).reply).toMatch(/full phone number/);
    expect((await driver.say("07700 900123")).reply).toMatch(/message to say/);
    const done = await driver.say("Please call me about Saturday opening hours");
    expect(done.reply).toMatch(/passed your message to the team \(reference /);
    expect(done.events.some((e) => e.type === "record")).toBe(true);
    expect(services.messages).toEqual([
      expect.objectContaining({
        callerName: "Priya Shah",
        callerPhone: "+447700900123",
        reason: "Please call me about Saturday opening hours",
      }),
    ]);
    expect(done.usage).toEqual([]);
    // Anything after that just repeats the confirmation; no second message.
    await driver.say("thanks");
    expect(services.messages).toHaveLength(1);
  });

  it("uses the caller ID on phone calls and speaks the caller's language", async () => {
    const { driver, services } = setup(makeContext({ aiPaused: "platform", style: "voice" }));
    driver.start({ language: "es", callerPhone: "+447700900456" });
    expect((await driver.say("Hola, quería preguntar algo")).reply).toMatch(/tomar un mensaje/);
    expect((await driver.say("Carlos")).reply).toMatch(/qué mensaje/);
    await driver.say("Llámenme mañana, por favor");
    expect(services.messages[0]).toMatchObject({
      callerName: "Carlos",
      callerPhone: "+447700900456",
    });
  });

  it("a suspended business only says the service isn't available", async () => {
    const { driver, services } = setup(makeContext({ suspended: true, aiPaused: "platform" }));
    expect(driver.start()).toMatch(/isn't available right now/);
    const result = await driver.say("Hello?");
    expect(result.reply).toMatch(/isn't available right now/);
    expect(result.state.endRequested).toBe(true);
    expect(services.messages).toHaveLength(0);
  });

  it("still gives emergency guidance first", async () => {
    const { driver } = setup();
    driver.start();
    expect((await driver.say("my dad is having a heart attack")).reply).toMatch(/999/);
  });
});
