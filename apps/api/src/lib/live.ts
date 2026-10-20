import { EventEmitter } from "node:events";

/**
 * In-process live events for the website chat widget and the inbox (Server-Sent Events).
 * One API process for now; with several, swap this for Redis pub/sub behind the same API.
 */
export interface LiveEvent {
  tenantId: string;
  threadId: string;
  /** "handoff": a phone call ringing at, answered from or leaving the VA console. */
  type: "message" | "mode" | "thread" | "handoff";
  /** For "message": who wrote it and the text. */
  role?: "caller" | "agent";
  human?: boolean;
  authorName?: string;
  text?: string;
  mode?: "ai" | "human";
}

class LiveHub {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(event: LiveEvent): void {
    this.emitter.emit(`thread:${event.threadId}`, event);
    this.emitter.emit(`tenant:${event.tenantId}`, event);
  }

  subscribe(channel: `thread:${string}` | `tenant:${string}`, fn: (e: LiveEvent) => void) {
    this.emitter.on(channel, fn);
    return () => this.emitter.off(channel, fn);
  }
}

export const live = new LiveHub();

/**
 * Forwards live events published by the workers (Redis pub/sub) into this process, e.g. a
 * WhatsApp message the worker just answered. Returns a function that stops listening.
 */
export async function bridgeLiveFromRedis(
  subscriber: {
    subscribe(channel: string): Promise<unknown>;
    on(event: "message", fn: (channel: string, message: string) => void): unknown;
    quit(): Promise<unknown>;
  },
  channel: string,
): Promise<() => Promise<void>> {
  subscriber.on("message", (from, message) => {
    if (from !== channel) return;
    try {
      const event = JSON.parse(message) as LiveEvent;
      if (event.tenantId && event.threadId) live.publish(event);
    } catch {
      // ignore malformed events
    }
  });
  await subscriber.subscribe(channel);
  return async () => {
    await subscriber.quit();
  };
}
