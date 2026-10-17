import { loadRootEnv } from "@voicedesk/config/load-env";
import { describe, expect, it } from "vitest";
import { AnthropicLlmProvider } from "../src/llm/anthropic";
import { estimateCostUsd } from "../src/llm/pricing";
import { responseText } from "../src/llm/types";
import { MockLlmProvider } from "../src/mocks";

loadRootEnv();

describe("MockLlmProvider", () => {
  it("serves queued responses, then the responder, then an echo", async () => {
    const llm = new MockLlmProvider((req) =>
      req.purpose === "special" ? MockLlmProvider.text("from responder") : undefined,
    ).enqueue(MockLlmProvider.toolUse("search_knowledge", { query: "hours" }));
    const base = { tier: "realtime" as const, system: [], maxTokens: 100 };

    const first = await llm.complete({ ...base, messages: [{ role: "user", content: "hi" }] });
    expect(first.stopReason).toBe("tool_use");
    const second = await llm.complete({
      ...base,
      purpose: "special",
      messages: [{ role: "user", content: "x" }],
    });
    expect(responseText(second)).toBe("from responder");
    const third = await llm.complete({ ...base, messages: [{ role: "user", content: "hello" }] });
    expect(responseText(third)).toBe("(mock) hello");
    expect(llm.requests).toHaveLength(3);
  });
});

describe("estimateCostUsd", () => {
  it("prices Haiku 5.5 and Sonnet 5.5 per million tokens", () => {
    expect(
      estimateCostUsd("claude-haiku-5-5", { input: 1e6, output: 1e6, cacheRead: 0, cacheWrite: 0 }),
    ).toBeCloseTo(0.6);
    expect(
      estimateCostUsd("claude-sonnet-5-5", {
        input: 1e6,
        output: 0,
        cacheRead: 1e6,
        cacheWrite: 0,
      }),
    ).toBeCloseTo(2.2);
  });
});

// Costs real money (fractions of a cent): RUN_LIVE_LLM=1 pnpm test
describe.runIf(process.env.RUN_LIVE_LLM === "1")("AnthropicLlmProvider (live)", () => {
  const llm = new AnthropicLlmProvider({
    models: {
      realtime: process.env.LLM_MODEL_REALTIME ?? "claude-haiku-5-5",
      reasoning: process.env.LLM_MODEL_REASONING ?? "claude-sonnet-5-5",
    },
  });

  it("streams a short reply and reports usage", async () => {
    let streamed = "";
    const res = await llm.stream(
      {
        tier: "realtime",
        system: ["Reply with exactly one short sentence."],
        messages: [{ role: "user", content: "Say hello to a customer called Sam." }],
        maxTokens: 200,
      },
      (d) => (streamed += d),
    );
    expect(responseText(res)).toContain("Sam");
    expect(streamed.trim()).toBe(responseText(res));
    expect(res.usage.costUsd).toBeGreaterThan(0);
  }, 60_000);

  it("calls a tool and returns structured JSON", async () => {
    const toolRes = await llm.complete({
      tier: "realtime",
      system: ["Use the lookup tool to answer."],
      messages: [{ role: "user", content: "What time do you open on Monday?" }],
      tools: [
        {
          name: "lookup_hours",
          description: "Look up opening hours for a weekday.",
          inputSchema: {
            type: "object",
            properties: { day: { type: "string" } },
            required: ["day"],
            additionalProperties: false,
          },
        },
      ],
      maxTokens: 500,
    });
    expect(toolRes.stopReason).toBe("tool_use");

    const json = await llm.complete({
      tier: "reasoning",
      system: ["Extract the data."],
      messages: [{ role: "user", content: "Bright Dental, 12 High St, open 9-5." }],
      jsonSchema: {
        type: "object",
        properties: { name: { type: "string" }, address: { type: "string" } },
        required: ["name", "address"],
        additionalProperties: false,
      },
      maxTokens: 1000,
    });
    expect(JSON.parse(responseText(json))).toMatchObject({ name: "Bright Dental" });
  }, 120_000);
});
