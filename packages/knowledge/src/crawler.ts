import robotsParser from "robots-parser";
import { extractHtml } from "./extract";
import { USER_AGENT, type SafeFetch } from "./safe-fetch";

export interface CrawledPage {
  url: string;
  title: string | null;
  text: string;
}

export interface CrawlOptions {
  pageLimit: number;
  /** Minimum delay between requests (politeness); robots.txt Crawl-delay wins if larger. */
  delayMs?: number;
  fetch: SafeFetch;
  onPage?: (page: CrawledPage) => Promise<void> | void;
  onSkip?: (url: string, reason: string) => void;
}

export interface CrawlResult {
  pages: number;
  skipped: number;
  visited: string[];
}

const SKIP_EXTENSIONS =
  /\.(jpe?g|png|gif|webp|svg|ico|css|js|mjs|json|xml|zip|gz|rar|mp[34]|mov|avi|woff2?|ttf|eot|pdf|docx?|xlsx?|pptx?)$/i;

function normalise(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    // Drop common tracking parameters so the same page isn't crawled twice.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.pathname !== "/" && url.pathname.endsWith("/"))
      url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return null;
  }
}

/** Same site = same hostname, ignoring a leading "www.". */
function sameSite(a: URL, b: URL): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}

async function sitemapUrls(
  fetchFn: SafeFetch,
  sitemapUrl: string,
  limit: number,
): Promise<string[]> {
  const found: string[] = [];
  const queue = [sitemapUrl];
  const seen = new Set<string>();
  while (queue.length && found.length < limit && seen.size < 10) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await fetchFn(url);
      if (res.status !== 200) continue;
      const xml = res.body.toString("utf8");
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.trim());
      if (/<sitemapindex/i.test(xml)) queue.push(...locs);
      else found.push(...locs);
    } catch {
      // a missing or broken sitemap is not an error
    }
  }
  return found.slice(0, limit);
}

/**
 * Breadth-first crawl of one website, respecting robots.txt, same-site only, HTML only.
 */
export async function crawlSite(startUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const start = new URL(startUrl);
  const origin = start.origin;

  let robots: ReturnType<typeof robotsParser> | null = null;
  try {
    const res = await options.fetch(`${origin}/robots.txt`);
    if (res.status === 200)
      robots = robotsParser(`${origin}/robots.txt`, res.body.toString("utf8"));
  } catch {
    // no robots.txt → everything allowed
  }
  const crawlDelayMs = Math.min((robots?.getCrawlDelay(USER_AGENT) ?? 0) * 1000, 10_000);
  const delayMs = Math.max(options.delayMs ?? 1000, crawlDelayMs);
  const allowed = (url: string) => robots?.isAllowed(url, USER_AGENT) ?? true;

  const queue: string[] = [];
  const seen = new Set<string>();
  const enqueue = (raw: string) => {
    const n = normalise(raw);
    if (!n || seen.has(n)) return;
    const url = new URL(n);
    if (!sameSite(url, start) || SKIP_EXTENSIONS.test(url.pathname)) return;
    seen.add(n);
    queue.push(n);
  };

  enqueue(start.toString());
  const sitemaps = robots?.getSitemaps() ?? [];
  for (const sm of sitemaps.length ? sitemaps : [`${origin}/sitemap.xml`]) {
    for (const url of await sitemapUrls(options.fetch, sm, options.pageLimit * 2)) enqueue(url);
  }

  const result: CrawlResult = { pages: 0, skipped: 0, visited: [] };
  const processed = new Set<string>();
  let lastRequest = 0;
  while (queue.length > 0 && result.pages < options.pageLimit) {
    const url = queue.shift()!;
    if (!allowed(url)) {
      result.skipped++;
      options.onSkip?.(url, "disallowed by robots.txt");
      continue;
    }
    const wait = lastRequest + delayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    try {
      const res = await options.fetch(url);
      result.visited.push(url);
      if (res.status !== 200 || !/text\/html|application\/xhtml/i.test(res.contentType)) {
        result.skipped++;
        options.onSkip?.(url, `status ${res.status} / ${res.contentType || "unknown type"}`);
        continue;
      }
      // Redirects may leave the site; only keep same-site final URLs.
      if (!sameSite(new URL(res.url), start)) {
        result.skipped++;
        continue;
      }
      // A redirect can land on a page we've already processed.
      const finalUrl = normalise(res.url) ?? res.url;
      if (processed.has(finalUrl)) continue;
      processed.add(finalUrl);
      seen.add(finalUrl);
      const page = extractHtml(res.body.toString("utf8"), res.url);
      for (const link of page.links) enqueue(link);
      if (page.text.length < 50) {
        result.skipped++;
        continue;
      }
      result.pages++;
      await options.onPage?.({ url: res.url, title: page.title, text: page.text });
    } catch (error) {
      result.skipped++;
      options.onSkip?.(url, error instanceof Error ? error.message : "fetch failed");
    }
  }
  return result;
}
