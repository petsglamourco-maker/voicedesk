/** Raised by any adapter when the upstream provider fails. Business logic catches this type only. */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly options: { retryable: boolean; cause?: unknown } = { retryable: false },
  ) {
    super(`[${provider}] ${message}`, { cause: options.cause });
    this.name = "ProviderError";
  }

  get retryable(): boolean {
    return this.options.retryable;
  }
}
