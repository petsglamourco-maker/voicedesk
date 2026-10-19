import { RoomAgentDispatch, RoomConfiguration, SipClient } from "livekit-server-sdk";
import { VOICE_AGENT_NAME } from "./voice";

/** Dispatch metadata for phone calls (read by apps/voice-agent `parseJobMetadata`). */
export interface PhoneJobMetadata {
  tenantId: string;
  phoneNumberId: string;
}

/** Who delivers the number's calls. Decides how LiveKit checks that a call is genuine. */
export type PhoneCarrier = "twilio" | "telnyx";
export const PHONE_CARRIERS = ["twilio", "telnyx"] as const;

/**
 * Telnyx's signalling IPs, Europe and US regions (https://sip.telnyx.com, checked
 * 2026-10-19). Telnyx delivers inbound calls without a SIP login, so its trunks accept
 * calls only from these addresses. Override with TELNYX_SIP_ALLOWED_ADDRESSES.
 */
export const TELNYX_SIGNALLING_IPS = [
  "185.246.41.140/32",
  "185.246.41.141/32",
  "192.76.120.10/32",
  "64.16.250.10/32",
];

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
  createRoute(params: {
    e164: string;
    carrier: PhoneCarrier;
    metadata: PhoneJobMetadata;
  }): Promise<SipRoute>;
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
  const list = (value: string | undefined) =>
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  // Twilio TwiML <Dial><Sip> sends a username and password; trunks then reject anything
  // without them. (Elastic SIP Trunking origination can't authenticate; use the address
  // allow-list for that instead.)
  const twilioAuth =
    env.SIP_AUTH_USERNAME && env.SIP_AUTH_PASSWORD
      ? { authUsername: env.SIP_AUTH_USERNAME, authPassword: env.SIP_AUTH_PASSWORD }
      : {};
  const twilioAddresses = list(env.SIP_ALLOWED_ADDRESSES);
  const telnyxAddresses = list(env.TELNYX_SIP_ALLOWED_ADDRESSES);
  const security = (carrier: PhoneCarrier) =>
    carrier === "telnyx"
      ? { allowedAddresses: telnyxAddresses.length ? telnyxAddresses : TELNYX_SIGNALLING_IPS }
      : { ...(twilioAddresses.length ? { allowedAddresses: twilioAddresses } : {}), ...twilioAuth };

  return {
    async createRoute({ e164, carrier, metadata }) {
      const trunk = await sip.createSipInboundTrunk(`voicedesk ${e164}`, [e164], {
        ...security(carrier),
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
