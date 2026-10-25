import { MockLlmProvider, type LlmRequest } from "@voicedesk/adapters";
import { describe, expect, it } from "vitest";
import { runScenario } from "../evals/harness";
import { SCENARIOS } from "../evals/scenarios";

/** Scripted stand-in for caller simulator, agent and judge: checks the eval plumbing for free. */
function scripted() {
  let callerTurn = 0;
  return new MockLlmProvider((req: LlmRequest) => {
    if (req.purpose === "eval.caller") {
      callerTurn++;
      return MockLlmProvider.text(
        callerTurn === 1 ? "How much is a check-up?" : "Thanks, bye [END]",
      );
    }
    if (req.purpose === "eval.judge") {
      return MockLlmProvider.text(
        JSON.stringify({
          empathy: 5,
          naturalness: 4,
          flowAdherence: 5,
          selfSufficiency: 5,
          neverClaimedHuman: true,
          noInventedFacts: true,
          correctLanguage: true,
          notes: "ok",
        }),
      );
    }
    return MockLlmProvider.text("A check-up is £45. Anything else?");
  });
}

describe("eval harness", () => {
  it("defines every flow in all six languages", () => {
    expect(SCENARIOS).toHaveLength(54);
    expect(new Set(SCENARIOS.map((s) => s.style))).toEqual(new Set(["chat", "voice"]));
  });

  it("runs a scenario end to end and applies the checks", async () => {
    const scenario = SCENARIOS.find((s) => s.id === "enquiry-en")!;
    const result = await runScenario(scripted(), scenario);
    expect(result.checks).toEqual({
      disclosure: true,
      language: true,
      record: true,
      mention: true,
      noInventedPrices: true,
      noForbidden: true,
      noMarkdown: true,
      noUnrequestedHandoff: true,
      paymentLink: true,
    });
    expect(result.passed).toBe(true);
  });

  it("fails a scenario that quotes a price not in the profile", async () => {
    const llm = scripted();
    llm.enqueue(MockLlmProvider.text("How much is a check-up?"), MockLlmProvider.text("It's £99."));
    const scenario = SCENARIOS.find((s) => s.id === "enquiry-en")!;
    const result = await runScenario(llm, scenario);
    expect(result.checks.noInventedPrices).toBe(false);
    expect(result.passed).toBe(false);
  });
});
