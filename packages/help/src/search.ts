import type { EmbeddingProvider } from "@voicedesk/adapters";
import type { HelpArticle, HelpRole, HelpSection } from "./articles";

export interface HelpHit {
  articleId: string;
  title: string;
  heading: string;
  page: string | null;
  text: string;
  score: number;
}

const STOP = new Set(
  "a an and are be can do does for from how i in is it my of on or the this to what when where which why with you your".split(
    " ",
  ),
);

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

/**
 * Search over help sections: meaning (local embeddings, cosine via dot product of normalised
 * vectors) blended with keyword overlap, so it also works without the embedding model and
 * still catches exact terms like error codes ("32205").
 */
export class HelpIndex {
  private readonly sections: Array<HelpSection & { article: HelpArticle; terms: Set<string> }>;
  private vectors: Promise<number[][]> | undefined;

  constructor(
    articles: HelpArticle[],
    private readonly embeddings?: () => Promise<EmbeddingProvider>,
  ) {
    this.sections = articles.flatMap((article) =>
      article.sections.map((s) => ({
        ...s,
        article,
        terms: new Set(
          words(`${article.title} ${s.heading} ${article.keywords.join(" ")} ${s.text}`),
        ),
      })),
    );
  }

  private passage(i: number) {
    const s = this.sections[i]!;
    return `${s.article.title}. ${s.heading}. ${s.text}`.slice(0, 2000);
  }

  private async sectionVectors(provider: EmbeddingProvider): Promise<number[][]> {
    this.vectors ??= provider.embed(
      this.sections.map((_, i) => this.passage(i)),
      "passage",
    );
    try {
      return await this.vectors;
    } catch (error) {
      this.vectors = undefined;
      throw error;
    }
  }

  async search(query: string, opts: { limit?: number; role?: HelpRole } = {}): Promise<HelpHit[]> {
    const limit = opts.limit ?? 4;
    const q = words(query);
    const keyword = this.sections.map((s) => {
      if (!q.length) return 0;
      const hits = q.filter((w) => s.terms.has(w)).length;
      return hits / q.length;
    });

    let meaning: number[] | null = null;
    if (this.embeddings) {
      try {
        const provider = await this.embeddings();
        const [qv] = await provider.embed([query], "query");
        const vectors = await this.sectionVectors(provider);
        meaning = vectors.map((v) => v.reduce((sum, x, i) => sum + x * qv![i]!, 0));
      } catch {
        meaning = null; // keyword search still answers
      }
    }

    return (
      this.sections
        .map((s, i) => ({
          s,
          score: meaning ? 0.7 * meaning[i]! + 0.3 * keyword[i]! : keyword[i]!,
          relevant: !opts.role || s.article.roles.includes(opts.role),
        }))
        .filter((x) => x.score > 0)
        // Sections for the asker's role first, then the rest (a staff member may still ask
        // what the owner has to do).
        .sort((a, b) => Number(b.relevant) - Number(a.relevant) || b.score - a.score)
        .slice(0, limit)
        .map(({ s, score }) => ({
          articleId: s.articleId,
          title: s.article.title,
          heading: s.heading,
          page: s.article.page,
          text: s.text,
          score: Number(score.toFixed(3)),
        }))
    );
  }
}
