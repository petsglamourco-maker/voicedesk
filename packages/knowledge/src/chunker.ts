import { estimateTokens } from "./text";

export interface Chunk {
  ordinal: number;
  heading: string | null;
  content: string;
  tokenCount: number;
}

export interface ChunkOptions {
  targetTokens?: number;
  /** Fraction of the target carried over into the next chunk. */
  overlap?: number;
}

/**
 * Splits text into retrieval chunks. Lines starting with "#" are treated as headings
 * (the extractors emit them); each chunk is prefixed with its heading so it stands alone.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const target = options.targetTokens ?? 400;
  const overlapTokens = Math.floor(target * (options.overlap ?? 0.15));

  // Group paragraphs under their nearest heading.
  const sections: Array<{ heading: string | null; paragraphs: string[] }> = [];
  let current: { heading: string | null; paragraphs: string[] } = { heading: null, paragraphs: [] };
  for (const block of text.split(/\n{2,}|\n(?=#)/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(trimmed.split("\n")[0]!);
    if (heading) {
      if (current.paragraphs.length || current.heading) sections.push(current);
      const rest = trimmed.split("\n").slice(1).join("\n").trim();
      current = { heading: heading[1]!.trim(), paragraphs: rest ? [rest] : [] };
    } else {
      current.paragraphs.push(trimmed);
    }
  }
  sections.push(current);

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const pieces = section.paragraphs.flatMap((p) => splitLong(p, target));
    let buffer: string[] = [];
    let tokens = 0;
    let hasNew = false; // buffer holds content not yet emitted (beyond carried overlap)
    const flush = () => {
      const body = buffer.join("\n\n");
      const content = section.heading ? `${section.heading}\n\n${body}` : body;
      chunks.push({
        ordinal: chunks.length,
        heading: section.heading,
        content,
        tokenCount: estimateTokens(content),
      });
      // Carry trailing paragraphs forward as overlap (never the whole buffer).
      const carried: string[] = [];
      let carriedTokens = 0;
      for (let i = buffer.length - 1; i > 0; i--) {
        const t = estimateTokens(buffer[i]!);
        if (carriedTokens + t > overlapTokens) break;
        carried.unshift(buffer[i]!);
        carriedTokens += t;
      }
      buffer = carried;
      tokens = carriedTokens;
      hasNew = false;
    };
    for (const piece of pieces) {
      const t = estimateTokens(piece);
      if (tokens + t > target && hasNew) flush();
      buffer.push(piece);
      tokens += t;
      hasNew = true;
    }
    if (hasNew) flush();
    if (pieces.length === 0 && section.heading) {
      chunks.push({
        ordinal: chunks.length,
        heading: section.heading,
        content: section.heading,
        tokenCount: estimateTokens(section.heading),
      });
    }
  }
  return chunks.filter((c) => c.content.trim().length > 0);
}

/** Splits an over-long paragraph on sentence boundaries (or hard-wraps as a last resort). */
function splitLong(paragraph: string, target: number): string[] {
  if (estimateTokens(paragraph) <= target) return [paragraph];
  const sentences = paragraph.match(
    /[^.!?\u3002\uff01\uff1f]+[.!?\u3002\uff01\uff1f]+["')\]]*\s*|.+$/gsu,
  ) ?? [paragraph];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (estimateTokens(buf + s) > target && buf) {
      out.push(buf.trim());
      buf = "";
    }
    if (estimateTokens(s) > target) {
      const size = target * 3;
      for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size).trim());
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
