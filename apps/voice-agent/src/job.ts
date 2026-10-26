import { tenantKey, type ObjectStorage } from "@voicedesk/adapters";
import {
  agentSettings,
  conversationMessages,
  conversations,
  phoneNumbers,
  withTenant,
  type Database,
  type VoiceMetrics,
} from "@voicedesk/db";
import { and, asc, eq } from "drizzle-orm";

export interface JobIds {
  tenantId: string;
  conversationId: string;
}

/** Dispatch metadata: browser test calls (apps/api voice.ts) or phone calls (apps/api sip.ts). */
export type JobMetadata =
  | {
      kind: "browser";
      tenantId: string;
      conversationId: string;
      /** ADR 0029: an instant demo (nothing is sent; the call ends after maxSeconds). */
      demo?: boolean;
      maxSeconds?: number;
    }
  /** Phase 6: a call the assistant placed (the conversation and opening already exist). */
  | {
      kind: "outbound";
      tenantId: string;
      conversationId: string;
      outboundCallId: string;
      /** The business's number, left on voicemail. */
      callbackNumber?: string;
    }
  | { kind: "phone"; tenantId: string; phoneNumberId: string };

export function parseJobMetadata(raw: string): JobMetadata {
  const value = JSON.parse(raw || "{}") as Record<string, unknown>;
  if (typeof value.tenantId !== "string") throw new Error("job metadata must include tenantId");
  if (typeof value.outboundCallId === "string" && typeof value.conversationId === "string") {
    return {
      kind: "outbound",
      tenantId: value.tenantId,
      conversationId: value.conversationId,
      outboundCallId: value.outboundCallId,
      ...(typeof value.callbackNumber === "string" ? { callbackNumber: value.callbackNumber } : {}),
    };
  }
  if (typeof value.conversationId === "string") {
    const demo = value.demo === true;
    const max = Number(value.maxSeconds);
    return {
      kind: "browser",
      tenantId: value.tenantId,
      conversationId: value.conversationId,
      ...(demo
        ? { demo, maxSeconds: Number.isFinite(max) ? Math.min(Math.max(max, 30), 600) : 180 }
        : {}),
    };
  }
  if (typeof value.phoneNumberId === "string") {
    return { kind: "phone", tenantId: value.tenantId, phoneNumberId: value.phoneNumberId };
  }
  throw new Error("job metadata must include conversationId or phoneNumberId");
}

/** Caller's number from the SIP participant attributes; withheld numbers come through empty or as "anonymous". */
export function callerFromSip(attributes: Record<string, string>): {
  callerPhone: string | null;
  withheld: boolean;
} {
  const raw = (attributes["sip.phoneNumber"] ?? "").trim();
  const digits = raw.replace(/[^\d+]/g, "");
  if (!/^\+?\d{6,15}$/.test(digits)) return { callerPhone: null, withheld: true };
  return { callerPhone: digits.startsWith("+") ? digits : `+${digits}`, withheld: false };
}

/**
 * Whether the call was forwarded to us (ADR 0025): carriers add a Diversion header, and a
 * Twilio TwiML Bin can pass X-Forwarded-From. The inbound trunk maps both to attributes.
 */
export function forwardedFromSip(attributes: Record<string, string>): boolean {
  return Boolean(attributes["vd.diversion"]?.trim() || attributes["vd.forwardedFrom"]?.trim());
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

/** The called number, if it is still active for this business (else the call is refused). */
export async function activePhoneNumber(
  db: Database,
  tenantId: string,
  phoneNumberId: string,
): Promise<{ id: string; e164: string } | null> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ id: phoneNumbers.id, e164: phoneNumbers.e164, status: phoneNumbers.status })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.id, phoneNumberId), eq(phoneNumbers.tenantId, tenantId))),
  );
  return row && row.status === "active" ? { id: row.id, e164: row.e164 } : null;
}

/** Per-call latency summary for the call log and the latency dashboard. */
export async function saveVoiceMetrics(db: Database, ids: JobIds, metrics: VoiceMetrics) {
  await withTenant(db, ids.tenantId, (tx) =>
    tx
      .update(conversations)
      .set({ voiceMetrics: metrics })
      .where(eq(conversations.id, ids.conversationId)),
  );
}

/** Uploads the call recording to our object storage and links it to the conversation. */
export async function saveRecording(
  db: Database,
  storage: ObjectStorage,
  ids: JobIds,
  wav: Uint8Array,
): Promise<string> {
  const key = tenantKey(ids.tenantId, "recordings", `${ids.conversationId}.wav`);
  await storage.put({ key, body: wav, contentType: "audio/wav" });
  await withTenant(db, ids.tenantId, (tx) =>
    tx
      .update(conversations)
      .set({ recordingKey: key })
      .where(eq(conversations.id, ids.conversationId)),
  );
  return key;
}

/** How long the VA console rings for this business before falling back (Phase 5). */
export async function ringSecondsFor(db: Database, tenantId: string): Promise<number> {
  const [row] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ ringSeconds: agentSettings.ringSeconds })
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId)),
  );
  return Math.min(Math.max(row?.ringSeconds ?? 30, 10), 120);
}
