/** Text embeddings for knowledge retrieval. See ADR 0010. */
export interface EmbeddingProvider {
  readonly name: string;
  /** Model identifier stored alongside each chunk (re-embed when it changes). */
  readonly model: string;
  readonly dimensions: number;
  /**
   * Embeds texts. `kind` distinguishes search queries from stored passages (asymmetric
   * models like E5 need different prefixes). Returned vectors are L2-normalised.
   */
  embed(texts: string[], kind: "query" | "passage"): Promise<number[][]>;
}
