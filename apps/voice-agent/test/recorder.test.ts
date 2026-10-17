import { describe, expect, it } from "vitest";
import { CallRecorder, RECORDING_SAMPLE_RATE, toMono16k } from "../src/recorder";
import { SilenceHandler } from "../src/silence";

/** A frame of constant value, `ms` long. */
function frame(value: number, ms: number, sampleRate = 48_000, channels = 1) {
  const samples = Math.round((sampleRate * ms) / 1000);
  return { data: new Int16Array(samples * channels).fill(value), sampleRate, channels };
}

function readWav(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  const frames = view.getUint32(40, true) / 4;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < frames; i++) {
    left.push(view.getInt16(44 + i * 4, true));
    right.push(view.getInt16(46 + i * 4, true));
  }
  return {
    riff: text(0, 4),
    wave: text(8, 4),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    left,
    right,
  };
}

const ms = (n: number) => (n * RECORDING_SAMPLE_RATE) / 1000;

describe("toMono16k", () => {
  it("downmixes and resamples", () => {
    expect(toMono16k(frame(100, 10, 48_000, 2))).toHaveLength(160);
    expect(toMono16k(frame(100, 10, 24_000)).every((v) => v === 100)).toBe(true);
    expect(toMono16k(frame(7, 10, 16_000))).toHaveLength(160);
  });
});

describe("CallRecorder", () => {
  it("writes a stereo WAV with the caller left and the assistant right", () => {
    const t0 = 1_000_000;
    const rec = new CallRecorder(t0);
    rec.addCaller(frame(1000, 100), t0 + 100); // caller: 0–100 ms
    rec.addAgent(frame(2000, 200, 24_000), t0 + 300); // assistant: 300–500 ms
    const wav = readWav(rec.toWav());
    expect([wav.riff, wav.wave, wav.channels, wav.sampleRate]).toEqual(["RIFF", "WAVE", 2, 16_000]);
    expect(wav.left[ms(50)]).toBe(1000);
    expect(wav.left[ms(400)]).toBe(0);
    expect(wav.right[ms(50)]).toBe(0);
    expect(wav.right[ms(400)]).toBe(2000);
    expect(rec.durationSeconds).toBeCloseTo(0.5, 2);
  });

  it("lays assistant audio end to end even when it arrives in a burst", () => {
    const t0 = 0;
    const rec = new CallRecorder(t0);
    for (let i = 0; i < 5; i++) rec.addAgent(frame(500, 100, 24_000), t0 + 1000);
    expect(rec.durationSeconds).toBeCloseTo(1.5, 2); // starts at 1 s, 5 × 100 ms
  });

  it("drops assistant audio that was queued but cut off by an interruption", () => {
    const t0 = 0;
    const rec = new CallRecorder(t0);
    for (let i = 0; i < 10; i++) rec.addAgent(frame(500, 100, 24_000), t0);
    rec.interruptAgent(t0 + 300);
    const wav = readWav(rec.toWav());
    expect(wav.right[ms(200)]).toBe(500);
    expect(wav.right.length).toBe(ms(300));
  });
});

describe("SilenceHandler", () => {
  it("checks in once, then says goodbye; speech resets it", async () => {
    const calls: string[] = [];
    const s = new SilenceHandler({
      stillThere: () => Promise.resolve(calls.push("still there?")),
      goodbye: () => Promise.resolve(calls.push("goodbye")),
    });
    await s.onUserState("away");
    await s.onUserState("speaking");
    await s.onUserState("away");
    expect(calls).toEqual(["still there?", "still there?"]);
    await s.onUserState("listening");
    await s.onUserState("away");
    expect(calls).toEqual(["still there?", "still there?", "goodbye"]);
  });
});
