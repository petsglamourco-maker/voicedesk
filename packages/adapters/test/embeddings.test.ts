import { describe, expect, it } from "vitest";
import { LocalEmbeddingProvider } from "../src/embeddings/local";
import type { EmbeddingProvider } from "../src/embeddings/types";
import { MockEmbeddingProvider } from "../src/mocks";

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

async function contract(provider: EmbeddingProvider) {
  const [q, related, unrelated] = [
    ...(await provider.embed(["What are your opening hours?"], "query")),
    ...(await provider.embed(
      ["Our opening hours are Monday to Friday, 9am to 5pm.", "We sell plumbing parts."],
      "passage",
    )),
  ];
  expect(q).toHaveLength(provider.dimensions);
  expect(Math.abs(cosine(q!, q!) - 1)).toBeLessThan(1e-3); // normalised
  expect(cosine(q!, related!)).toBeGreaterThan(cosine(q!, unrelated!));
}

describe("MockEmbeddingProvider", () => {
  it("satisfies the embedding contract", () => contract(new MockEmbeddingProvider()));
});

// Downloads ~120 MB on first run, so opt-in: RUN_LOCAL_EMBEDDINGS=1 pnpm test
describe.runIf(process.env.RUN_LOCAL_EMBEDDINGS === "1")("LocalEmbeddingProvider", () => {
  const provider = new LocalEmbeddingProvider();

  it("satisfies the embedding contract", () => contract(provider), 300_000);

  it("matches across languages", async () => {
    const [query] = await provider.embed(["¿Cuál es su horario de apertura?"], "query");
    const [hours, parts] = await provider.embed(
      ["Our opening hours are Monday to Friday, 9am to 5pm.", "We sell plumbing parts."],
      "passage",
    );
    expect(cosine(query!, hours!)).toBeGreaterThan(cosine(query!, parts!));
  }, 120_000);
});
