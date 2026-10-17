import { describe, expect, it } from "vitest";
import { chunkText } from "../src/chunker";
import { extractFile, extractHtml, fileTypeFor } from "../src/extract";
import { cleanText, detectLanguage, estimateTokens } from "../src/text";

describe("text utilities", () => {
  it("cleans whitespace and invisible characters", () => {
    expect(cleanText("  Hello​   world \r\n\n\n\nBye\t ")).toBe("Hello world\n\nBye");
  });

  it("estimates CJK tokens per character", () => {
    expect(estimateTokens("你好世界")).toBe(4);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("detects the six supported languages", () => {
    expect(detectLanguage("We are open and you can book with our team for the day")).toBe("en");
    expect(
      detectLanguage("Estamos abiertos para que la gente pueda reservar con el equipo del día"),
    ).toBe("es");
    expect(
      detectLanguage("Nous sommes ouverts pour vous avec une équipe dans la ville, les jours"),
    ).toBe("fr");
    expect(
      detectLanguage("Wir sind für Sie da und die Praxis ist mit dem Team nicht geschlossen"),
    ).toBe("de");
    expect(detectLanguage("我们的诊所周一至周五营业，欢迎预约。")).toBe("zh");
    expect(detectLanguage("عيادتنا مفتوحة من الاثنين إلى الجمعة")).toBe("ar");
  });
});

describe("chunkText", () => {
  it("keeps headings with their content and respects the target size", () => {
    const para = "The clinic offers check-ups and hygiene appointments. ".repeat(30);
    const text = `# Services\n\n${para}\n\n${para}\n\n# Opening hours\n\nMonday to Friday 9am to 5pm.`;
    const chunks = chunkText(text, { targetTokens: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.tokenCount <= 480)).toBe(true);
    const hours = chunks.find((c) => c.heading === "Opening hours");
    expect(hours?.content).toBe("Opening hours\n\nMonday to Friday 9am to 5pm.");
    expect(
      chunks.filter((c) => c.heading === "Services").every((c) => c.content.startsWith("Services")),
    ).toBe(true);
  });

  it("splits a single huge paragraph", () => {
    const chunks = chunkText("Sentence one is here. ".repeat(500), { targetTokens: 200 });
    expect(chunks.length).toBeGreaterThan(5);
  });

  it("ignores empty input", () => {
    expect(chunkText("   ")).toEqual([]);
  });
});

describe("extractHtml", () => {
  const html = `<!doctype html><html><head><title>Bright Dental | Home</title>
    <script type="application/ld+json">{"@type":"Dentist","telephone":"+44 20 7946 0958","openingHours":"Mo-Fr 09:00-17:00"}</script>
    </head><body><nav><a href="/about">About</a><a href="https://other.example/x">Other</a><a href="#top">Top</a></nav>
    <main><h1>Welcome to Bright Dental</h1><p>Friendly family dentistry in Camden. We offer check-ups, hygiene and whitening.</p>
    <h2>Prices</h2><ul><li>Check-up £45</li><li>Hygiene £60</li></ul><script>alert(1)</script></main></body></html>`;

  it("extracts headings, lists, JSON-LD and links", () => {
    const page = extractHtml(html, "https://bright.example/");
    expect(page.title).toContain("Bright Dental");
    expect(page.text).toContain("# Welcome to Bright Dental");
    expect(page.text).toContain("- Check-up £45");
    expect(page.text).toContain("openingHours");
    expect(page.text).not.toContain("alert(1)");
    expect(page.links).toContain("https://bright.example/about");
    expect(page.links).toContain("https://other.example/x");
  });
});

describe("file extraction", () => {
  it("detects supported types", () => {
    expect(fileTypeFor("menu.PDF")).toBe("pdf");
    expect(fileTypeFor("faq.docx")).toBe("docx");
    expect(fileTypeFor("prices.csv")).toBe("csv");
    expect(fileTypeFor("notes.md")).toBe("txt");
    expect(fileTypeFor("photo.jpg", "image/jpeg")).toBeNull();
  });

  it("turns CSV rows into readable lines", async () => {
    const csv = "Service,Price,Duration\nCheck-up,£45,30 min\nWhitening,£250,60 min\n";
    const text = await extractFile(new TextEncoder().encode(csv), "csv");
    expect(text).toBe(
      "Service: Check-up; Price: £45; Duration: 30 min\n\nService: Whitening; Price: £250; Duration: 60 min",
    );
  });

  it("extracts text from a PDF", async () => {
    const pdf = minimalPdf("Opening hours Monday to Friday");
    const text = await extractFile(pdf, "pdf");
    expect(text).toContain("Opening hours Monday to Friday");
  });
});

/** Builds a tiny valid single-page PDF containing one line of text. */
function minimalPdf(line: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
