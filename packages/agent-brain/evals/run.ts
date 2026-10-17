// Runs the golden-conversation evals against the AI providers switched on in platform settings: `pnpm eval [--filter=complaint] [--lang=es] [--limit=N]`
// Costs real money (roughly $0.01–0.03 per conversation). Results go to evals/results/.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isLlmAvailable, type LlmProvider } from "@voicedesk/adapters";
import { loadRootEnv } from "@voicedesk/config/load-env";
import { createAppLlm, SecretBox } from "@voicedesk/core";
import { closeDb, createDb } from "@voicedesk/db";
import { PROMPT_VERSION } from "../src/prompt";
import { runScenario } from "./harness";
import { SCENARIOS } from "./scenarios";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  loadRootEnv();
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string]),
  );
  // Uses whichever providers are switched on in Platform admin → AI providers.
  const db = createDb(process.env.DATABASE_URL!);
  const llm = createAppLlm(db, {
    box: SecretBox.fromEnv(),
    anthropicEnvKey: process.env.ANTHROPIC_API_KEY || undefined,
  });
  if (!(await isLlmAvailable(llm))) {
    console.error(
      "Evals need a real model: switch on an AI provider in Platform admin → AI providers.",
    );
    await closeDb(db);
    process.exit(1);
  }
  // Wrap the provider to account for every call's cost (agent, simulator and judge).
  let total = 0;
  const metered: LlmProvider = {
    name: llm.name,
    complete: async (r) => {
      const res = await llm.complete(r);
      total += res.usage.costUsd;
      return res;
    },
    stream: async (r, on) => {
      const res = await llm.stream(r, on);
      total += res.usage.costUsd;
      return res;
    },
  };

  let scenarios = SCENARIOS.filter(
    (s) => (!args.filter || s.flow === args.filter) && (!args.lang || s.language === args.lang),
  );
  if (args.limit) scenarios = scenarios.slice(0, Number(args.limit));
  console.log(`Running ${scenarios.length} scenarios (prompt ${PROMPT_VERSION})…`);

  const results: Array<
    { id: string; passed: boolean; error?: string } & Partial<
      Awaited<ReturnType<typeof runScenario>>
    >
  > = [];
  const queue = [...scenarios];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const s = queue.shift()!;
        try {
          const r = await runScenario(metered, s);
          results.push(r);
          const c = Object.entries(r.checks)
            .filter(([, ok]) => !ok)
            .map(([k]) => k);
          console.log(
            `${r.passed ? "PASS" : "FAIL"} ${s.id.padEnd(16)} turns=${r.turns} median=${r.medianLatencyMs}ms empathy=${r.judge.empathy} natural=${r.judge.naturalness} flow=${r.judge.flowAdherence} self=${r.judge.selfSufficiency}${c.length ? ` failed=${c.join(",")}` : ""}${r.passed ? "" : ` — ${r.judge.notes}`}`,
          );
        } catch (error) {
          console.log(`ERROR ${s.id}: ${error instanceof Error ? error.message : String(error)}`);
          results.push({ id: s.id, passed: false, error: String(error) });
        }
      }
    }),
  );

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} passed · total spend $${total.toFixed(4)}`);
  const dir = join(here, "results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    file,
    JSON.stringify({ promptVersion: PROMPT_VERSION, totalCostUsd: total, results }, null, 2),
  );
  console.log(`Report: ${file}`);
  await closeDb(db);
  process.exit(passed === results.length ? 0 : 1);
}

await main();
