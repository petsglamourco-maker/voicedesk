import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { EmbeddingProvider } from "./types";

export interface LocalEmbeddingConfig {
  /** Hugging Face model id (ONNX). Default: Xenova/multilingual-e5-small (384-d, 100 languages). */
  model?: string;
  /** Where downloaded model files are cached. */
  cacheDir?: string;
  batchSize?: number;
}

/**
 * Runs an open multilingual embedding model on the CPU via transformers.js (ONNX runtime).
 * Free, and no text leaves the machine. The model downloads once (~120 MB) on first use.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";
  readonly model: string;
  readonly dimensions = 384;
  private extractor?: Promise<FeatureExtractionPipeline>;

  constructor(private readonly config: LocalEmbeddingConfig = {}) {
    this.model = config.model ?? "Xenova/multilingual-e5-small";
  }

  private load(): Promise<FeatureExtractionPipeline> {
    this.extractor ??= pipeline("feature-extraction", this.model, {
      dtype: "q8",
      ...(this.config.cacheDir ? { cache_dir: this.config.cacheDir } : {}),
    });
    return this.extractor;
  }

  async embed(texts: string[], kind: "query" | "passage"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    const batchSize = this.config.batchSize ?? 16;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => `${kind}: ${t}`);
      const tensor = await extractor(batch, { pooling: "mean", normalize: true });
      out.push(...(tensor.tolist() as number[][]));
    }
    return out;
  }
}
