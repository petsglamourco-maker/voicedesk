import {
  RoomAgentDispatch,
  RoomConfiguration,
  SipClient,
  type CreateSipOutboundTrunkOptions,
} from "livekit-server-sdk";

/** SIPTransport.SIP_TRANSPORT_TCP in @livekit/protocol (not a direct dependency). */
const SIP_TRANSPORT_TCP = 2 as CreateSipOutboundTrunkOptions["transport"];
import { VOICE_AGENT_NAME } from "./voice";

/** SIP headers that show a call was forwarded, mapped to participant attributes. */
export const FORWARDING_HEADERS = {
  Diversion: "vd.diversion",
  "X-Forwarded-From": "vd.forwardedFrom",
};

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
  /** Whether outbound calls through this carrier are set up in .env (Phase 5). */
  canDial(carrier: PhoneCarrier): boolean;
  /**
   * Rings `to` from the business's number and puts the call in `roomName` (where the person
   * calling is). Costs per minute at the carrier.
   */
  dial(params: {
    carrier: PhoneCarrier;
    from: string;
    to: string;
    roomName: string;
    participantIdentity: string;
  }): Promise<void>;
}

/**
 * Outbound calls go through the carrier's SIP termination with a login: Twilio Elastic SIP
 * Trunking (termination URI + credential list) or a Telnyx credentials connection.
 */
function outboundFromEnv(env: NodeJS.ProcessEnv, carrier: PhoneCarrier) {
  const prefix = `SIP_OUTBOUND_${carrier.toUpperCase()}`;
  const host = env[`${prefix}_HOST`] || (carrier === "telnyx" ? "sip.telnyx.com" : "");
  const username = env[`${prefix}_USERNAME`];
  const password = env[`${prefix}_PASSWORD`];
  return host && username && password ? { host, username, password } : null;
}

export function sipGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): SipGateway | null {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return null;
  const sip = new SipClient(
    LIVEKIT_URL.replace(/^ws/, "http"),
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    { requestTimeout: 15 }, // dialling has its own 30 s (security audit M15)
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
        // Forwarded calls (missed by the team, ADR 0025) are detected from these headers.
        headersToAttributes: FORWARDING_HEADERS,
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
    canDial: (carrier) => outboundFromEnv(env, carrier) !== null,
    async dial({ carrier, from, to, roomName, participantIdentity }) {
      const outbound = outboundFromEnv(env, carrier);
      if (!outbound) throw new Error(`Outbound calling through ${carrier} isn't set up`);
      // One LiveKit outbound trunk per business number (its caller ID), created on first use.
      // The carrier login is refreshed from .env on every call, so changing it takes effect
      // (a stale copy made Twilio reject calls with 32202 "bad user credentials").
      const name = `voicedesk out ${from}`;
      let existing = (await sip.listSipOutboundTrunk()).find((t) => t.name === name);
      if (existing && existing.address !== outbound.host) {
        await sip.deleteSipTrunk(existing.sipTrunkId).catch(() => undefined);
        existing = undefined;
      }
      if (existing) {
        await sip.updateSipOutboundTrunkFields(existing.sipTrunkId, {
          authUsername: outbound.username,
          authPassword: outbound.password,
        });
      }
      const trunkId =
        existing?.sipTrunkId ??
        (
          await sip.createSipOutboundTrunk(name, outbound.host, [from], {
            transport: SIP_TRANSPORT_TCP,
            authUsername: outbound.username,
            authPassword: outbound.password,
          })
        ).sipTrunkId;
      await sip.createSipParticipant(trunkId, to, roomName, {
        fromNumber: from,
        participantIdentity,
        participantName: "Customer",
        playDialtone: true,
        ringingTimeout: 40,
        maxCallDuration: 60 * 60,
      });
    },
    async deleteRoute({ trunkId, dispatchRuleId }) {
      // Ignore "not found": removing a number must work even if it was deleted in LiveKit.
      if (dispatchRuleId) await sip.deleteSipDispatchRule(dispatchRuleId).catch(() => undefined);
      if (trunkId) await sip.deleteSipTrunk(trunkId).catch(() => undefined);
    },
  };
}
