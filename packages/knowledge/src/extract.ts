import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import mammoth from "mammoth";
import Papa from "papaparse";
import { extractText, getDocumentProxy } from "unpdf";
import { cleanText } from "./text";

export interface ExtractedPage {
  title: string | null;
  /** Main content as text; headings are emitted as "# " lines for the chunker. */
  text: string;
  /** Absolute same-document links found on the page (for crawling). */
  links: string[];
}

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "LI",
  "TR",
  "TABLE",
  "UL",
  "OL",
  "BR",
  "ADDRESS",
  "BLOCKQUOTE",
  "PRE",
  "DD",
  "DT",
  "FIGCAPTION",
  "HEADER",
  "FOOTER",
  "MAIN",
]);

/** Converts a DOM subtree to readable text, preserving headings and list structure. */
function domToText(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "IFRAME"].includes(tag)) return;
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      out.push(`\n\n${"#".repeat(Number(heading[1]))} ${(el.textContent ?? "").trim()}\n\n`);
      return;
    }
    if (tag === "LI") out.push("\n- ");
    else if (tag === "TD" || tag === "TH") out.push(" | ");
    else if (BLOCK_TAGS.has(tag)) out.push("\n\n");
    for (const child of Array.from(el.childNodes)) walk(child);
    if (BLOCK_TAGS.has(tag)) out.push("\n\n");
  };
  walk(root);
  return cleanText(out.join(""));
}

/**
 * Pulls schema.org JSON-LD (LocalBusiness hours, address, phone...) — often the most
 * reliable facts on small-business sites — as compact text.
 */
function structuredData(document: Document): string {
  const blocks: string[] = [];
  for (const script of Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )) {
    try {
      const data = JSON.parse(script.textContent ?? "") as unknown;
      blocks.push(JSON.stringify(data));
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return blocks.length ? `# Structured data\n\n${blocks.join("\n").slice(0, 8000)}` : "";
}

export function extractHtml(html: string, pageUrl: string): ExtractedPage {
  const { document } = parseHTML(html);
  const links = new Set<string>();
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    try {
      const href = new URL(a.getAttribute("href") ?? "", pageUrl);
      href.hash = "";
      if (href.protocol === "http:" || href.protocol === "https:") links.add(href.toString());
    } catch {
      // ignore invalid hrefs
    }
  }
  const title = document.querySelector("title")?.textContent?.trim() || null;
  const jsonLd = structuredData(document);

  // Readability mutates the DOM, so run it on a fresh parse.
  const article = new Readability(parseHTML(html).document, {
    charThreshold: 200,
  }).parse();
  let text = "";
  if (article?.content) {
    const { document: contentDoc } = parseHTML(`<html><body>${article.content}</body></html>`);
    text = domToText(contentDoc.body);
  }
  if (text.length < 200) {
    // Short pages (contact, hours) often get dropped by Readability; fall back to the body.
    const body = document.querySelector("main") ?? document.body;
    text = body ? domToText(body) : text;
  }
  return {
    title: article?.title?.trim() || title,
    text: [text, jsonLd].filter(Boolean).join("\n\n"),
    links: [...links],
  };
}

export type SupportedFileType = "pdf" | "docx" | "csv" | "txt";

export function fileTypeFor(fileName: string, mimeType?: string): SupportedFileType | null {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "csv" || mimeType === "text/csv") return "csv";
  if (ext === "txt" || ext === "md" || mimeType?.startsWith("text/")) return "txt";
  return null;
}

export async function extractFile(data: Uint8Array, type: SupportedFileType): Promise<string> {
  switch (type) {
    case "pdf": {
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: false });
      return cleanText(text.map((page, i) => `# Page ${i + 1}\n\n${page}`).join("\n\n"));
    }
    case "docx": {
      const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(data) });
      const { document } = parseHTML(`<html><body>${value}</body></html>`);
      return domToText(document.body);
    }
    case "csv": {
      const parsed = Papa.parse<Record<string, string>>(new TextDecoder().decode(data), {
        header: true,
        skipEmptyLines: true,
      });
      // One line per row: "Header: value; Header: value" — readable for both humans and RAG.
      return cleanText(
        parsed.data
          .map((row) =>
            Object.entries(row)
              .filter(([, v]) => v?.trim())
              .map(([k, v]) => `${k}: ${v}`)
              .join("; "),
          )
          .join("\n\n"),
      );
    }
    case "txt":
      return cleanText(new TextDecoder().decode(data));
  }
}
