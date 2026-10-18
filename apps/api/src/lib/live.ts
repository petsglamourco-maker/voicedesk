import { EventEmitter } from "node:events";

/**
 * In-process live events for the website chat widget and the inbox (Server-Sent Events).
 * One API process for now; with several, swap this for Redis pub/sub behind the same API.
 */
export interface LiveEvent {
  tenantId: string;
  threadId: string;
  type: "message" | "mode" | "thread";
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
