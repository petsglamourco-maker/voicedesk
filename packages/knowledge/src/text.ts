import { createHash } from "node:crypto";

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Collapses whitespace, strips control characters and zero-width characters. */
export function cleanText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

/** Rough token estimate: ~1 token per CJK character, ~4 characters per token otherwise. */
export function estimateTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

const STOPWORDS: Record<"en" | "es" | "fr" | "de", string[]> = {
  en: ["the", "and", "you", "with", "for", "are", "our", "this", "that", "your", "have"],
  es: ["el", "la", "los", "las", "que", "para", "con", "una", "por", "nuestro", "del"],
  fr: ["le", "la", "les", "des", "est", "pour", "avec", "une", "vous", "nous", "dans"],
  de: ["der", "die", "das", "und", "ist", "mit", "für", "ein", "eine", "wir", "nicht"],
};

/**
 * Cheap language guess for metadata: script detection for Chinese/Arabic, stopword counts
 * for Latin-script languages. Returns null when unsure.
 */
export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 4000);
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return null;
  if ((sample.match(CJK)?.length ?? 0) / letters > 0.3) return "zh";
  if ((sample.match(/[\u0600-\u06ff]/g)?.length ?? 0) / letters > 0.3) return "ar";
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  let best: string | null = null;
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length;
    if (score > bestScore) [best, bestScore] = [lang, score];
  }
  return bestScore >= 3 ? best : null;
}
