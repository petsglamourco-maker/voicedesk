import type { TextToSpeechProvider } from "@voicedesk/adapters";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";

/** Name the voice worker registers under; dispatches must use the same name. */
export const VOICE_AGENT_NAME = "voicedesk-agent";

export interface VoiceJobMetadata {
  tenantId: string;
  conversationId: string;
  /** ADR 0029: an instant demo (the worker sends nothing and ends after maxSeconds). */
  demo?: true;
  maxSeconds?: number;
}

/** Real-time voice sessions (LiveKit). Narrow so tests can fake it. */
export interface VoiceGateway {
  /** Creates the room's agent dispatch and a browser token for the caller. */
  createSession(params: {
    roomName: string;
    identity: string;
    displayName: string;
    metadata: VoiceJobMetadata;
  }): Promise<{ url: string; token: string }>;
  /** A token for a person joining an existing call from the VA console (Phase 5). */
  joinCall(params: {
    roomName: string;
    identity: string;
    displayName: string;
  }): Promise<{ url: string; token: string }>;
  /** Ends a call for everyone in it (the caller's phone line hangs up). */
  endCall(roomName: string): Promise<void>;
  /** Sends the assistant into a room (Phase 6 outbound calls), before the customer is dialled. */
  dispatchAgent(roomName: string, metadata: Record<string, unknown>): Promise<void>;
}

export function voiceGatewayFromEnv(env: NodeJS.ProcessEnv = process.env): VoiceGateway | null {
  const url = env.LIVEKIT_URL;
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return null;
  // LiveKit requests give up after 15 s instead of hanging (security audit M15).
  const options = { requestTimeout: 15 };
  const dispatch = new AgentDispatchClient(url.replace(/^ws/, "http"), apiKey, apiSecret, options);
  const rooms = new RoomServiceClient(url.replace(/^ws/, "http"), apiKey, apiSecret, options);
  return {
    async createSession({ roomName, identity, displayName, metadata }) {
      // Explicit dispatch: the worker only joins rooms we create (never all rooms).
      await dispatch.createDispatch(roomName, VOICE_AGENT_NAME, {
        metadata: JSON.stringify(metadata),
      });
      const token = new AccessToken(apiKey, apiSecret, {
        identity,
        name: displayName,
        ttl: "15m",
      });
      token.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      return { url, token: await token.toJwt() };
    },
    async joinCall({ roomName, identity, displayName }) {
      const token = new AccessToken(apiKey, apiSecret, { identity, name: displayName, ttl: "2h" });
      token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
      return { url, token: await token.toJwt() };
    },
    async dispatchAgent(roomName, metadata) {
      await dispatch.createDispatch(roomName, VOICE_AGENT_NAME, {
        metadata: JSON.stringify(metadata),
      });
    },
    async endCall(roomName) {
      await rooms.deleteRoom(roomName).catch(() => undefined);
    },
  };
}

export async function ttsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TextToSpeechProvider | null> {
  if (!env.ELEVENLABS_API_KEY) return null;
  const { ElevenLabsTtsProvider } = await import("@voicedesk/adapters/speech/elevenlabs");
  return new ElevenLabsTtsProvider({ apiKey: env.ELEVENLABS_API_KEY });
}
