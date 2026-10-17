import { conversationMessages, withTenant, type Database } from "@voicedesk/db";
import { and, asc, eq } from "drizzle-orm";

export interface JobIds {
  tenantId: string;
  conversationId: string;
}

/** Dispatch metadata set by the API (apps/api/src/lib/voice.ts). */
export function parseJobMetadata(raw: string): JobIds {
  const value = JSON.parse(raw || "{}") as Partial<Record<keyof JobIds, unknown>>;
  if (typeof value.tenantId !== "string" || typeof value.conversationId !== "string") {
    throw new Error("job metadata must include tenantId and conversationId");
  }
  return { tenantId: value.tenantId, conversationId: value.conversationId };
}

/** The conversation's first agent message: the fixed greeting with the AI disclosure. */
export async function loadGreeting(db: Database, ids: JobIds): Promise<string | null> {
  const [first] = await withTenant(db, ids.tenantId, (tx) =>
    tx
      .select({ content: conversationMessages.content })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, ids.conversationId),
          eq(conversationMessages.role, "agent"),
        ),
      )
      .orderBy(asc(conversationMessages.id))
      .limit(1),
  );
  return first?.content ?? null;
}
