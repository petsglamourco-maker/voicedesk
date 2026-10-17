import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProviderError } from "../src/errors";
import {
  OpenAiCompatibleProvider,
  stripThinking,
  type OpenAiCompatibleConfig,
} from "../src/llm/openai-compatible";
import { RoutedLlmProvider } from "../src/llm/router";
import { isLlmAvailable, responseText, type LlmRequest } from "../src/llm/types";
import { MockLlmProvider } from "../src/mocks";
import { startFakeOpenAi, type FakeServer } from "./fake-openai-server";

let server: FakeServer;

beforeAll(async () => {
  server = await startFakeOpenAi();
});
afterAll(() => server.close());

function provider(overrides: Partial<OpenAiCompatibleConfig> = {}) {
  return new OpenAiCompatibleProvider({
    key: "local",
    baseUrl: server.url,
    models: { realtime: "qwen3.6-35b-a3b", reasoning: "qwen3.6-35b-a3b" },
    thinking: { realtime: false, reasoning: true },
    thinkingControl: "reasoning_effort",
    structuredOutput: "json_schema",
    pricing: { inputPerM: 1, outputPerM: 2 },
    ...overrides,
  });
}

const base: LlmRequest = {
  tier: "realtime",
  system: ["You are helpful.", "Profile: Bright Dental"],
  messages: [{ role: "user", content: "Hi" }],
  maxTokens: 200,
};

describe("OpenAiCompatibleProvider", () => {
  it("streams text, reports usage and cost, and disables thinking for live turns", async () => {
    server.replies.push({
      content: "Hello there, how can I help?",
      usage: { prompt_tokens: 1000, completion_tokens: 10 },
    });
    const deltas: string[] = [];
    const res = await provider().stream(base, (d) => deltas.push(d));
    expect(responseText(res)).toBe("Hello there, how can I help?");
    expect(deltas.join("")).toBe("Hello there, how can I help?");
    expect(res.usage).toMatchObject({
      model: "qwen3.6-35b-a3b",
      inputTokens: 1000,
      outputTokens: 10,
    });
    expect(res.usage.costUsd).toBeCloseTo((1000 * 1 + 10 * 2) / 1e6);
    const req = server.requests.at(-1)!;
    expect(req).toMatchObject({ model: "qwen3.6-35b-a3b", reasoning_effort: "none", stream: true });
    expect(req.messages).toEqual([
      { role: "system", content: "You are helpful.\n\nProfile: Bright Dental" },
      { role: "user", content: "Hi" },
    ]);
  });

  it("assembles streamed tool calls and replays a tool round trip", async () => {
    server.replies.push({
      content: "Let me check.",
      toolCalls: [
        {
          id: "call_1",
          name: "check_availability",
          arguments: '{"service":"Check-up","date":"2026-10-20"}',
        },
      ],
    });
    const p = provider();
    const first = await p.complete({
      ...base,
      tools: [
        { name: "check_availability", description: "slots", inputSchema: { type: "object" } },
      ],
    });
    expect(first.stopReason).toBe("tool_use");
    expect(first.content).toContainEqual({
      type: "tool_use",
      id: "call_1",
      name: "check_availability",
      input: { service: "Check-up", date: "2026-10-20" },
    });
    expect(server.requests.at(-1)!.tools).toEqual([
      {
        type: "function",
        function: {
          name: "check_availability",
          description: "slots",
          parameters: { type: "object" },
        },
      },
    ]);

    server.replies.push({ content: "I have 10:00 or 11:00." });
    await p.complete({
      ...base,
      messages: [
        { role: "user", content: "Book a check-up" },
        { role: "system", content: "[Engine note] Booking flow." },
        { role: "assistant", content: first.content, raw: first.raw },
        {
          role: "user",
          content: [{ type: "tool_result", toolUseId: "call_1", content: '{"slots":[]}' }],
        },
      ],
    });
    const msgs = server.requests.at(-1)!.messages as Array<Record<string, unknown>>;
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "system", "assistant", "tool"]);
    expect(msgs[3]).toMatchObject({
      tool_calls: [{ id: "call_1", function: { name: "check_availability" } }],
    });
    expect(msgs[4]).toEqual({ role: "tool", tool_call_id: "call_1", content: '{"slots":[]}' });
  });

  it("replays another provider's turn from neutral blocks, not its native content", async () => {
    server.replies.push({ content: "ok" });
    await provider().complete({
      ...base,
      messages: [
        { role: "user", content: "Hi" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hello from Claude" }],
          raw: { provider: "anthropic", data: [{ type: "thinking", thinking: "secret" }] },
        },
        { role: "user", content: "And?" },
      ],
    });
    const msgs = server.requests.at(-1)!.messages as Array<Record<string, unknown>>;
    expect(msgs[2]).toEqual({ role: "assistant", content: "Hello from Claude" });
  });

  it("keeps DeepSeek reasoning_content for replay to the same provider", async () => {
    server.replies.push({ reasoning: "thinking hard", content: "Done." });
    const deepseek = provider({
      key: "deepseek",
      thinkingControl: "deepseek",
      thinking: { realtime: true, reasoning: true },
    });
    const res = await deepseek.complete(base);
    expect(server.requests.at(-1)).toMatchObject({ thinking: { type: "enabled" } });
    server.replies.push({ content: "ok" });
    await deepseek.complete({
      ...base,
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: res.content, raw: res.raw },
        { role: "user", content: "x" },
      ],
    });
    const msgs = server.requests.at(-1)!.messages as Array<Record<string, unknown>>;
    expect(msgs[2]).toMatchObject({ role: "assistant", reasoning_content: "thinking hard" });
  });

  it("requests structured output in both modes", async () => {
    const schema = { type: "object", properties: { name: { type: "string" } }, required: ["name"] };
    server.replies.push({ content: '{"name":"Bright"}' });
    await provider().complete({ ...base, jsonSchema: schema });
    expect(server.requests.at(-1)!.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { schema },
    });

    server.replies.push({ content: '{"name":"Bright"}' });
    const res = await provider({ structuredOutput: "json_object" }).complete({
      ...base,
      jsonSchema: schema,
    });
    const req = server.requests.at(-1)!;
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(req.messages)).toContain("json object");
    expect(JSON.parse(responseText(res))).toEqual({ name: "Bright" });
  });

  it("hides <think> blocks from text and streamed deltas", async () => {
    server.replies.push({
      content: "<think>Let me reason about parking…</think>\n\nYes, there's a car park nearby.",
    });
    const deltas: string[] = [];
    const res = await provider().stream(base, (d) => deltas.push(d));
    expect(responseText(res)).toBe("Yes, there's a car park nearby.");
    expect(deltas.join("")).toBe("Yes, there's a car park nearby.");
    expect(stripThinking("a<think>x</think>b")).toBe("ab");
  });

  it("maps server errors and lists models", async () => {
    server.replies.push({ status: 500 }, { status: 500 }); // the SDK retries once
    await expect(provider().complete(base)).rejects.toBeInstanceOf(ProviderError);
    expect(await provider().listModels()).toEqual(["qwen3.6-35b-a3b"]);
    const dead = provider({ baseUrl: "http://127.0.0.1:9/v1", timeoutMs: 2000 });
    await expect(dead.complete(base)).rejects.toThrow(/connect|timed out/);
  });
});

describe("RoutedLlmProvider", () => {
  const failing = {
    name: "failing",
    complete: () => Promise.reject(new ProviderError("a", "down", { retryable: true })),
    stream: () => Promise.reject(new ProviderError("a", "down", { retryable: true })),
  };

  it("uses the first enabled provider and falls back on failure", async () => {
    const fallbacks: string[] = [];
    const router = new RoutedLlmProvider(
      () =>
        Promise.resolve([
          { key: "a", label: "Local", provider: failing },
          {
            key: "b",
            label: "DeepSeek",
            provider: new MockLlmProvider().enqueue(MockLlmProvider.text("from B")),
          },
        ]),
      { onFallback: (f) => fallbacks.push(`${f.from}->${f.to}`) },
    );
    expect(responseText(await router.complete(base))).toBe("from B");
    expect(fallbacks).toEqual(["Local->DeepSeek"]);
  });

  it("does not fall back after text has been streamed", async () => {
    const partial = {
      name: "partial",
      complete: () => Promise.reject(new Error("unused")),
      stream: (_r: LlmRequest, on: (d: string) => void) => {
        on("Hello…");
        return Promise.reject(new ProviderError("a", "dropped", { retryable: true }));
      },
    };
    const second = new MockLlmProvider();
    const router = new RoutedLlmProvider(() =>
      Promise.resolve([
        { key: "a", label: "A", provider: partial },
        { key: "b", label: "B", provider: second },
      ]),
    );
    await expect(router.stream(base, () => undefined)).rejects.toThrow(/dropped/);
    expect(second.requests).toHaveLength(0);
  });

  it("reports unavailability with nothing enabled and reloads after invalidate", async () => {
    let entries: Array<{ key: string; label: string; provider: MockLlmProvider }> = [];
    const router = new RoutedLlmProvider(() => Promise.resolve(entries), { ttlMs: 60_000 });
    expect(await isLlmAvailable(router)).toBe(false);
    await expect(router.complete(base)).rejects.toThrow(/No AI provider/);
    entries = [{ key: "m", label: "Mock", provider: new MockLlmProvider() }];
    expect(await isLlmAvailable(router)).toBe(false); // still cached
    router.invalidate();
    expect(await isLlmAvailable(router)).toBe(true);
  });
});
