import { voice } from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";

/**
 * Pass-through link in the agent's audio output chain that copies what is sent to the room,
 * for the call recording. Playback events come back up from the next link (base class).
 */
export class TeeAudioOutput extends voice.AudioOutput {
  constructor(
    private readonly next: voice.AudioOutput,
    private readonly hooks: { onFrame: (frame: AudioFrame) => void; onClear: () => void },
  ) {
    super(next.sampleRate, next, { pause: true });
  }

  override async captureFrame(frame: AudioFrame): Promise<void> {
    await super.captureFrame(frame);
    try {
      this.hooks.onFrame(frame);
    } catch {
      // Recording must never break the call.
    }
    await this.next.captureFrame(frame);
  }

  override flush(): void {
    super.flush();
    this.next.flush();
  }

  clearBuffer(): void {
    try {
      this.hooks.onClear();
    } catch {
      // ignore
    }
    this.next.clearBuffer();
  }

  override abandonOpenSegment(): void {
    super.abandonOpenSegment();
    this.next.abandonOpenSegment();
  }
}
