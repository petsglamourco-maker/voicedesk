// Estimated USD per million tokens (Anthropic first-party list prices, checked 2026-10-17).
// Used for margin reporting and spend visibility only; the Anthropic Console is the source
// of truth for billing. Cache writes ≈ 1.25× input, cache reads ≈ 0.1× input.
interface Price {
  input: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

const UNKNOWN: Price = { input: 4, output: 20 }; // assume the expensive end if unlisted

export function estimateCostUsd(
  model: string,
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number },
): number {
  const p = PRICES[model] ?? UNKNOWN;
  const cost =
    tokens.input * p.input +
    tokens.output * p.output +
    tokens.cacheRead * p.input * 0.1 +
    tokens.cacheWrite * p.input * 1.25;
  return Math.round((cost / 1_000_000) * 1e6) / 1e6;
}
