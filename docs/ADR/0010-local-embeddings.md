# ADR 0010 — Local multilingual embeddings behind an adapter

- **Status:** Accepted (2026-10-17)

## Context

Knowledge retrieval needs embeddings that work in six languages, including Chinese and Arabic. Anthropic doesn't offer an embeddings API. The owner wants the lowest cost and prefers data to stay local.

## Decision

- **Model:** `Xenova/multilingual-e5-small` (384 dimensions, 8-bit quantised) runs on the CPU via transformers.js (`@huggingface/transformers` + `onnxruntime-node`). It downloads once (~120 MB) to `.cache/models`.
- **Interface:** `EmbeddingProvider.embed(texts, "query" | "passage")` hides the E5 prefixes. A deterministic hashing mock is used for tests and CI (`EMBEDDINGS_PROVIDER=mock`).
- **Storage:** Postgres `vector(384)` with an HNSW cosine index. Every chunk records the `embedding_model` that produced it.

**Measured locally:**

- warm `searchKnowledge` over HTTP: about 67 ms end to end;
- a Spanish question correctly matches an English passage.

## Alternatives

Voyage AI (better quality, free tier, but another US sub-processor and another account). The adapter keeps this a configuration change.

## Consequences

- Changing model or dimension needs a migration (new vector size) and a re-embed job. The `embedding_model` column makes the affected rows easy to find.
- Ingestion is CPU-bound, so the knowledge queue runs one source at a time per worker.
