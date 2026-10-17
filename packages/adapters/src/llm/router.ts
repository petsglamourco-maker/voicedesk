import { ProviderError } from "../errors";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

/** One enabled provider, in priority order. */
export interface RouteEntry {
  key: string;
  label: string;
  provider: LlmProvider;
}

export interface RouterOptions {
  /** How long a loaded configuration is reused before reloading (ms). */
  ttlMs?: number;
  onFallback?: (info: { from: string; to: string | null; reason: string }) => void;
}

/**
 * Routes each LLM call to the first enabled provider, falling back to the next on
 * failure (ADR 0012). The provider list is reloaded periodically, so admin toggles take
 * effect without a restart. Fallback never happens after text has been streamed, to avoid
 * a reply that switches model mid-sentence.
 */
export class RoutedLlmProvider implements LlmProvider {
  readonly name = "router";
  private cache: { at: number; entries: RouteEntry[] } | null = null;
  private loading: Promise<RouteEntry[]> | null = null;

  constructor(
    private readonly load: () => Promise<RouteEntry[]>,
    private readonly options: RouterOptions = {},
  ) {}

  /** Forces the next call to reload the provider list (e.g. right after a settings change). */
  invalidate(): void {
    this.cache = null;
  }

  async entries(): Promise<RouteEntry[]> {
    const ttl = this.options.ttlMs ?? 10_000;
    if (this.cache && Date.now() - this.cache.at < ttl) return this.cache.entries;
    this.loading ??= this.load()
      .then((entries) => {
        this.cache = { at: Date.now(), entries };
        return entries;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  available = async (): Promise<boolean> => (await this.entries()).length > 0;

  complete(request: LlmRequest): Promise<LlmResponse> {
    return this.route((p) => p.complete(request));
  }

  stream(request: LlmRequest, onText: (delta: string) => void): Promise<LlmResponse> {
    let emitted = false;
    return this.route(
      (p) =>
        p.stream(request, (delta) => {
          emitted = true;
          onText(delta);
        }),
      () => emitted,
    );
  }

  private async route(
    call: (provider: LlmProvider) => Promise<LlmResponse>,
    committed: () => boolean = () => false,
  ): Promise<LlmResponse> {
    const entries = await this.entries();
    if (entries.length === 0) {
      throw new ProviderError("router", "No AI provider is switched on", { retryable: false });
    }
    let lastError: unknown;
    for (const [i, entry] of entries.entries()) {
      const next = entries[i + 1]?.label ?? null;
      try {
        const response = await call(entry.provider);
        if (response.stopReason === "refusal" && next && !committed()) {
          this.options.onFallback?.({ from: entry.label, to: next, reason: "refused" });
          lastError = new ProviderError(entry.key, "refused", { retryable: false });
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (committed()) break;
        this.options.onFallback?.({
          from: entry.label,
          to: next,
          reason: error instanceof Error ? error.message : "failed",
        });
      }
    }
    throw lastError instanceof ProviderError
      ? lastError
      : new ProviderError("router", "All AI providers failed", {
          retryable: true,
          cause: lastError,
        });
  }
}
