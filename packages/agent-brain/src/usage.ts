import type { LlmUsage } from "@voicedesk/adapters";
import { llmUsage, withTenant, type Database, type Tx } from "@voicedesk/db";

export async function recordLlmUsage(
  dbOrTx: { db: Database } | { tx: Tx },
  tenantId: string,
  purpose: string,
  usage: LlmUsage,
  conversationId?: string,
): Promise<void> {
  if (usage.model === "mock") return;
  const values = {
    tenantId,
    purpose,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costUsd: usage.costUsd,
    conversationId: conversationId ?? null,
  };
  if ("tx" in dbOrTx) {
    await dbOrTx.tx.insert(llmUsage).values(values);
  } else {
    await withTenant(dbOrTx.db, tenantId, (tx) => tx.insert(llmUsage).values(values));
  }
}
