/**
 * In-process call recorder (Phase 2b): caller on the left channel, assistant on the right,
 * placed by wall-clock time into a 16 kHz 16-bit stereo WAV. Nothing leaves our process
 * until the file is uploaded to our own object storage.
 */

export const RECORDING_SAMPLE_RATE = 16_000;
/** Hard cap so a stuck call can't exhaust memory (about 3.8 MB per minute). */
const MAX_SECONDS = 60 * 60;

export interface PcmFrame {
  data: Int16Array;
  sampleRate: number;
  channels: number;
}

/** Mono, resampled to 16 kHz by linear interpolation (good enough for speech). */
export function toMono16k(frame: PcmFrame): Int16Array {
  const { data, sampleRate, channels } = frame;
  const inSamples = Math.floor(data.length / channels);
  const mono = new Float32Array(inSamples);
  for (let i = 0; i < inSamples; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += data[i * channels + c]!;
    mono[i] = sum / channels;
  }
  if (sampleRate === RECORDING_SAMPLE_RATE) return Int16Array.from(mono, Math.round);
  const outSamples = Math.floor((inSamples * RECORDING_SAMPLE_RATE) / sampleRate);
  const out = new Int16Array(outSamples);
  const step = sampleRate / RECORDING_SAMPLE_RATE;
  for (let i = 0; i < outSamples; i++) {
    const pos = i * step;
    const j = Math.floor(pos);
    const frac = pos - j;
    const a = mono[j] ?? 0;
    const b = mono[j + 1] ?? a;
    out[i] = Math.round(a + (b - a) * frac);
  }
  return out;
}

class Track {
  buf = new Int16Array(RECORDING_SAMPLE_RATE * 30);
  cursor = 0;
  length = 0;

  write(samples: Int16Array, at: number): void {
    const end = Math.min(at + samples.length, RECORDING_SAMPLE_RATE * MAX_SECONDS);
    if (end <= at) return;
    if (end > this.buf.length) {
      const grown = new Int16Array(
        Math.min(Math.max(end, this.buf.length * 2), RECORDING_SAMPLE_RATE * MAX_SECONDS),
      );
      grown.set(this.buf);
      this.buf = grown;
    }
    this.buf.set(samples.subarray(0, end - at), at);
    this.cursor = end;
    this.length = Math.max(this.length, end);
  }

  /** Drops anything written after `at` (audio queued but never played). */
  truncate(at: number): void {
    if (this.cursor <= at) return;
    this.buf.fill(0, at, this.cursor);
    if (this.length === this.cursor) this.length = at;
    this.cursor = at;
  }
}

export class CallRecorder {
  private readonly caller = new Track();
  private readonly agent = new Track();

  constructor(private readonly t0: number = Date.now()) {}

  private index(at: number): number {
    return Math.max(0, Math.round(((at - this.t0) / 1000) * RECORDING_SAMPLE_RATE));
  }

  /**
   * Caller audio arrives in real time: frames are laid end to end, re-anchored to the clock
   * only after a gap (e.g. the stream restarted), so jitter doesn't chop the audio.
   */
  addCaller(frame: PcmFrame, at: number = Date.now()): void {
    const samples = toMono16k(frame);
    const clock = this.index(at) - samples.length;
    const drift = Math.abs(clock - this.caller.cursor);
    const pos =
      this.caller.cursor === 0 || drift > RECORDING_SAMPLE_RATE / 2
        ? Math.max(0, clock)
        : this.caller.cursor;
    this.caller.write(samples, pos);
  }

  /**
   * Assistant audio is produced faster than it plays, so frames are queued back to back from
   * the moment speech starts: that's when they are heard.
   */
  addAgent(frame: PcmFrame, at: number = Date.now()): void {
    const samples = toMono16k(frame);
    this.agent.write(samples, Math.max(this.agent.cursor, this.index(at)));
  }

  /** The caller interrupted: whatever was queued but not yet played was never heard. */
  interruptAgent(at: number = Date.now()): void {
    this.agent.truncate(this.index(at));
  }

  get durationSeconds(): number {
    return Math.max(this.caller.length, this.agent.length) / RECORDING_SAMPLE_RATE;
  }

  /** 16-bit PCM stereo WAV: left = caller, right = assistant. */
  toWav(): Uint8Array {
    const frames = Math.max(this.caller.length, this.agent.length);
    const dataBytes = frames * 4;
    const out = new Uint8Array(44 + dataBytes);
    const view = new DataView(out.buffer);
    const ascii = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 2, true); // stereo
    view.setUint32(24, RECORDING_SAMPLE_RATE, true);
    view.setUint32(28, RECORDING_SAMPLE_RATE * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, dataBytes, true);
    for (let i = 0; i < frames; i++) {
      view.setInt16(44 + i * 4, this.caller.buf[i] ?? 0, true);
      view.setInt16(46 + i * 4, this.agent.buf[i] ?? 0, true);
    }
    return out;
  }
}
