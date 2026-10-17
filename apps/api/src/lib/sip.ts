import { RoomAgentDispatch, RoomConfiguration, SipClient } from "livekit-server-sdk";
import { VOICE_AGENT_NAME } from "./voice";

/** Dispatch metadata for phone calls (read by apps/voice-agent `parseJobMetadata`). */
export interface PhoneJobMetadata {
  tenantId: string;
  phoneNumberId: string;
}

export interface SipRoute {
  trunkId: string;
  dispatchRuleId: string;
}

/**
 * Routes a phone number to the assistant: a LiveKit SIP inbound trunk that only accepts calls
 * to that number, and a dispatch rule that puts each call in its own room with the agent.
 * Narrow so tests can fake it.
 */
export interface SipGateway {
  createRoute(params: { e164: string; metadata: PhoneJobMetadata }): Promise<SipRoute>;
  deleteRoute(route: Partial<SipRoute>): Promise<void>;
}

export function sipGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): SipGateway | null {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return null;
  const sip = new SipClient(
    LIVEKIT_URL.replace(/^ws/, "http"),
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
  );
  // Twilio origination can't authenticate to LiveKit, so optionally restrict the source to
  // Twilio's published signalling ranges (comma-separated CIDRs).
  const allowedAddresses = (env.SIP_ALLOWED_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    async createRoute({ e164, metadata }) {
      const trunk = await sip.createSipInboundTrunk(`voicedesk ${e164}`, [e164], {
        ...(allowedAddresses.length ? { allowedAddresses } : {}),
        metadata: JSON.stringify(metadata),
      });
      try {
        const rule = await sip.createSipDispatchRule(
          { type: "individual", roomPrefix: "call-" },
          {
            name: `voicedesk ${e164}`,
            trunkIds: [trunk.sipTrunkId],
            roomConfig: new RoomConfiguration({
              agents: [
                new RoomAgentDispatch({
                  agentName: VOICE_AGENT_NAME,
                  metadata: JSON.stringify(metadata),
                }),
              ],
            }),
          },
        );
        return { trunkId: trunk.sipTrunkId, dispatchRuleId: rule.sipDispatchRuleId };
      } catch (error) {
        await sip.deleteSipTrunk(trunk.sipTrunkId).catch(() => undefined);
        throw error;
      }
    },
    async deleteRoute({ trunkId, dispatchRuleId }) {
      // Ignore "not found": removing a number must work even if it was deleted in LiveKit.
      if (dispatchRuleId) await sip.deleteSipDispatchRule(dispatchRuleId).catch(() => undefined);
      if (trunkId) await sip.deleteSipTrunk(trunkId).catch(() => undefined);
    },
  };
}
