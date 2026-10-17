import { conversationMessages, conversations, withTenant, type Database } from "@voicedesk/db";
import { and, eq, sql } from "drizzle-orm";
import type { AgentContext } from "./context";
import { recogniseCaller } from "./contacts";
import { startConversation, type TurnResult } from "./engine";
import type { Lang } from "./languages";
import type { ConversationState } from "./state";
import { recordLlmUsage } from "./usage";

/**
 * Starts a conversation: fixed greeting (AI disclosure, plus the recording notice when calls
 * are recorded), stored state and the greeting message. Shared by the test console, browser
 * voice and phone calls.
 */
export async function createConversation(
  db: Database,
  ctx: AgentContext,
  params: {
    tenantId: string;
    channel: "test_console" | "voice";
    language?: Lang;
    callerPhone?: string | null;
    createdBy?: string | null;
    phoneNumberId?: string | null;
    callerNumberWithheld?: boolean;
  },
): Promise<{ conversationId: string; state: ConversationState; greeting: string }> {
  const { state, greeting } = startConversation(ctx, {
    language: params.language,
    callerPhone: params.callerPhone ?? null,
    recordingNotice: ctx.style === "voice" && ctx.recordCalls === true,
  });
  const known = await recogniseCaller(db, params.tenantId, params.callerPhone ?? null);
  if (known) {
    state.knownCaller = {
      name: known.name,
      // Local time, so the assistant can say it without converting.
      upcoming: known.upcoming.map((u) => ({
        ...u,
        startsAt: new Date(u.startsAt).toLocaleString("en-GB", {
          timeZone: ctx.timezone,
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        }),
      })),
    };
  }
  const conversationId = await withTenant(db, params.tenantId, async (tx) => {
    const [row] = await tx
      .insert(conversations)
      .values({
        tenantId: params.tenantId,
        channel: params.channel,
        style: ctx.style,
        personaId: ctx.persona.id,
        language: state.language,
        state: state as unknown as Record<string, unknown>,
        createdBy: params.createdBy ?? null,
        phoneNumberId: params.phoneNumberId ?? null,
        callerNumberWithheld: params.callerNumberWithheld ?? false,
        contactId: known?.contactId ?? null,
      })
      .returning({ id: conversations.id });
    await tx.insert(conversationMessages).values({
      tenantId: params.tenantId,
      conversationId: row!.id,
      role: "agent",
      content: greeting,
      language: state.language,
    });
    return row!.id;
  });
  return { conversationId, state, greeting };
}

/**
 * Saves one engine turn: new state (optimistic concurrency on the turn counter), the
 * caller and agent messages, and LLM usage. Shared by the text console and the voice
 * worker so every channel stores conversations identically.
 *
 * Returns false when another turn was saved first (the caller should retry or report it).
 */
export async function persistTurn(
  db: Database,
  params: {
    tenantId: string;
    conversationId: string;
    previous: ConversationState;
    callerText: string;
    result: TurnResult;
    /** Channel-specific metrics, e.g. voice latency breakdown. */
    extraMetadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const { tenantId, conversationId, previous, callerText, result } = params;
  const costUsd = result.usage.reduce((s, u) => s + u.costUsd, 0);
  return withTenant(db, tenantId, async (tx) => {
    const updated = await tx
      .update(conversations)
      .set({
        state: result.state as unknown as Record<string, unknown>,
        language: result.state.language,
      })
      .where(
        and(
          eq(conversations.id, conversationId),
          sql`(${conversations.state}->>'turns')::int = ${previous.turns}`,
        ),
      )
      .returning({ id: conversations.id });
    if (updated.length === 0) return false;
    await tx.insert(conversationMessages).values([
      {
        tenantId,
        conversationId,
        role: "caller",
        content: callerText,
        language: result.state.language,
      },
      {
        tenantId,
        conversationId,
        role: "agent",
        content: result.reply,
        language: result.state.language,
        metadata: {
          flow: result.state.flow,
          latencyMs: result.latencyMs,
          costUsd,
          events: result.events,
          tokens: result.usage.map((u) => ({
            model: u.model,
            input: u.inputTokens,
            output: u.outputTokens,
            cacheRead: u.cacheReadTokens,
          })),
          ...params.extraMetadata,
        },
      },
    ]);
    for (const usage of result.usage) {
      await recordLlmUsage({ tx }, tenantId, "conversation.turn", usage, conversationId);
    }
    return true;
  });
}

/** Loads a conversation's engine state (RLS-scoped). */
export async function loadConversationState(
  db: Database,
  tenantId: string,
  conversationId: string,
): Promise<{ state: ConversationState; status: string; style: string } | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(conversations).where(eq(conversations.id, conversationId)),
  );
  if (!row) return null;
  return {
    state: row.state as unknown as ConversationState,
    status: row.status,
    style: row.style,
  };
}

/** Marks a conversation ended. Returns true if it was active (so a summary should follow). */
export async function endConversation(
  db: Database,
  tenantId: string,
  conversationId: string,
): Promise<boolean> {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .update(conversations)
      .set({ status: "ended", endedAt: new Date() })
      .where(and(eq(conversations.id, conversationId), eq(conversations.status, "active")))
      .returning({ turns: sql<number>`(${conversations.state}->>'turns')::int` }),
  );
  return rows.length > 0 && (rows[0]?.turns ?? 0) > 0;
}
