import { describe, expect, it } from "vitest";
import { startConversation } from "../src/engine";
import { LANGUAGES } from "../src/languages";
import { PERSONA_IDS } from "../src/personas";
import { recordingNotice } from "../src/phrases";
import { DEFAULT_VOICE_IDS, sttLanguageFor, voiceFor } from "../src/voices";
import { makeContext } from "./fixtures";

describe("voice catalogue", () => {
  it("has a distinct default voice for every persona", () => {
    const ids = PERSONA_IDS.map((p) => DEFAULT_VOICE_IDS[p]);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses a business's own voice when set", () => {
    expect(voiceFor("amelia", { amelia: "custom123" }).voiceId).toBe("custom123");
    expect(voiceFor("amelia", { amelia: "" }).voiceId).toBe(DEFAULT_VOICE_IDS.amelia);
    expect(voiceFor("james").model).toBe("eleven_flash_v2_5");
  });

  it("picks the speech-recognition language", () => {
    expect(["en", "es", "fr", "de"].map(sttLanguageFor)).toEqual([
      "multi",
      "multi",
      "multi",
      "multi",
    ]);
    expect(sttLanguageFor("zh")).toBe("zh");
    expect(sttLanguageFor("ar")).toBe("ar");
  });
});

describe("recording notice", () => {
  it("exists in every language", () => {
    for (const lang of LANGUAGES) expect(recordingNotice(lang).length).toBeGreaterThan(10);
  });

  it("follows the AI disclosure only when calls are recorded", () => {
    const plain = startConversation(makeContext({ style: "voice" })).greeting;
    const recorded = startConversation(makeContext({ style: "voice" }), {
      recordingNotice: true,
    }).greeting;
    expect(plain).not.toContain(recordingNotice("en"));
    expect(recorded.startsWith(plain.split("?")[0]!.split(".")[0]!)).toBe(true);
    expect(recorded).toContain(recordingNotice("en"));
    expect(recorded).toMatch(/AI/);
  });
});
