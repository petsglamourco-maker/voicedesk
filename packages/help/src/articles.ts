import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * End-user help articles (packages/help/articles/*.md): the knowledge of the in-app Help
 * assistant. Front-matter is a deliberately tiny format (one `key: value` per line) so no YAML
 * dependency is needed; `test/articles.test.ts` keeps every file valid.
 */
export const HELP_ROLES = ["owner", "admin", "staff", "va", "platform"] as const;
export type HelpRole = (typeof HELP_ROLES)[number];

export interface HelpSection {
  articleId: string;
  /** Section heading ("" for the text before the first `##`). */
  heading: string;
  text: string;
}

export interface HelpArticle {
  id: string;
  title: string;
  /** App route it explains, with `:tenant` for the business id; null for general articles. */
  page: string | null;
  /** Who it's for; "all" expands to every role. */
  roles: HelpRole[];
  keywords: string[];
  /** Starter questions shown on `page`. */
  suggested: string[];
  body: string;
  sections: HelpSection[];
}

const KEYS = ["id", "title", "page", "roles", "keywords", "suggested"] as const;

const list = (value: string, separator: string) =>
  value
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s && s !== "none");

export function parseArticle(source: string): HelpArticle {
  const text = source.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error("missing front-matter");
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    if (!line.trim()) continue;
    const at = line.indexOf(":");
    if (at < 1) throw new Error(`bad front-matter line: ${line}`);
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  for (const key of KEYS) if (!(key in meta)) throw new Error(`missing "${key}"`);
  const unknown = Object.keys(meta).filter((k) => !(KEYS as readonly string[]).includes(k));
  if (unknown.length) throw new Error(`unknown keys: ${unknown.join(", ")}`);

  const id = meta.id!;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`bad id "${id}"`);
  const rawRoles = list(meta.roles!, ",");
  const roles = rawRoles.includes("all") ? [...HELP_ROLES] : (rawRoles as HelpRole[]);
  for (const r of roles)
    if (!(HELP_ROLES as readonly string[]).includes(r)) throw new Error(`unknown role "${r}"`);
  const body = match[2]!.trim();

  return {
    id,
    title: meta.title!,
    page: meta.page === "none" || !meta.page ? null : meta.page,
    roles,
    keywords: list(meta.keywords!, ","),
    suggested: list(meta.suggested!, "|"),
    body,
    sections: splitSections(id, body),
  };
}

/** One searchable piece per `##` section (the intro before the first heading included). */
function splitSections(articleId: string, body: string): HelpSection[] {
  const sections: HelpSection[] = [];
  let heading = "";
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) sections.push({ articleId, heading, text });
  };
  for (const line of body.split("\n")) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      flush();
      heading = h[1]!.trim();
      lines = [];
    } else if (!/^#\s/.test(line)) {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

let cache: HelpArticle[] | undefined;

/** Every article, read once from packages/help/articles. */
export function listArticles(): HelpArticle[] {
  if (cache) return cache;
  const dir = fileURLToPath(new URL("../articles/", import.meta.url));
  cache = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      try {
        return parseArticle(readFileSync(`${dir}${f}`, "utf8"));
      } catch (error) {
        throw new Error(`help article ${f}: ${(error as Error).message}`, { cause: error });
      }
    });
  return cache;
}

export function getArticle(id: string): HelpArticle | undefined {
  return listArticles().find((a) => a.id === id);
}

/** `/t/:tenant/integrations` → matches `/t/<uuid>/integrations` (and its sub-pages). */
function pageMatcher(page: string): RegExp {
  const pattern = page
    .split("/")
    .map((part) => (part === ":tenant" ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${pattern}(/.*)?$`);
}

/** The article for the screen at `pathname`: the most specific page match wins. */
export function articleForPage(pathname: string, articles = listArticles()): HelpArticle | null {
  const path = pathname.split("?")[0]!.replace(/\/+$/, "") || "/";
  const matches = articles
    .filter((a) => a.page && pageMatcher(a.page).test(path))
    .sort((a, b) => b.page!.length - a.page!.length);
  return matches[0] ?? null;
}

/** Starter questions for a screen, with general ones when the screen has none. */
export function suggestionsFor(pathname: string, articles = listArticles()): string[] {
  const own = articleForPage(pathname, articles)?.suggested ?? [];
  const general = articles.find((a) => a.id === "getting-started")?.suggested ?? [];
  return [...new Set([...own, ...general])].slice(0, 4);
}

/** Fills in the business id in help links (`/t/:tenant/…`). */
export function withTenantLinks(text: string, tenantId: string | null): string {
  return tenantId ? text.replaceAll("/t/:tenant", `/t/${tenantId}`) : text;
}
