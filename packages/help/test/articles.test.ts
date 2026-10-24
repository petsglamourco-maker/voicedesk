import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { articleForPage, listArticles } from "../src/articles";

/** Every screen people can open (keep in step with apps/web/src/app). */
const SCREENS = [
  "/t/:tenant",
  "/t/:tenant/inbox",
  "/t/:tenant/ask",
  "/t/:tenant/calls",
  "/t/:tenant/contacts",
  "/t/:tenant/records",
  "/t/:tenant/feedback",
  "/t/:tenant/website-chat",
  "/t/:tenant/whatsapp",
  "/t/:tenant/email",
  "/t/:tenant/forms",
  "/t/:tenant/agent",
  "/t/:tenant/knowledge",
  "/t/:tenant/profile",
  "/t/:tenant/integrations",
  "/t/:tenant/console",
  "/t/:tenant/members",
  "/t/:tenant/usage",
  "/t/:tenant/account",
  "/va",
  "/platform/setup",
  "/platform/ai",
  "/platform/phone-numbers",
  "/platform/vas",
  "/platform/spending",
  "/platform/support",
];
const ROUTES = new Set([...SCREENS, "/onboarding"]);

describe("help articles (packages/help/articles)", () => {
  const articles = listArticles();

  it("all load, with unique ids matching their file names", () => {
    const dir = fileURLToPath(new URL("../articles/", import.meta.url));
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(articles.map((a) => a.id).sort()).toEqual(files);
    expect(articles.length).toBeGreaterThanOrEqual(30);
  });

  it.each(SCREENS)("%s has an article", (screen) => {
    const sample = screen.replace(":tenant", "5e2d8e81-4cb1-4a4c-891e-af4f18e21db2");
    expect(articleForPage(sample, articles), screen).not.toBeNull();
  });

  it("only links to real in-app screens", () => {
    const bad: string[] = [];
    for (const a of articles) {
      if (a.page && !ROUTES.has(a.page)) bad.push(`${a.id}: page ${a.page}`);
      for (const [, target] of a.body.matchAll(/\]\(([^)\s]+)\)/g)) {
        const path = target!.split(/[?#]/)[0]!;
        if (!ROUTES.has(path)) bad.push(`${a.id}: link ${target}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("has a few well-formed starter questions per screen", () => {
    for (const a of articles) {
      expect(a.suggested.length, a.id).toBeLessThanOrEqual(3);
      for (const q of a.suggested) expect(q.endsWith("?"), `${a.id}: ${q}`).toBe(true);
      if (a.page) expect(a.suggested.length, a.id).toBeGreaterThan(0);
      expect(a.sections.length, a.id).toBeGreaterThan(0);
    }
  });
});
