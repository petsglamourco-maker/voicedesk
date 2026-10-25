import { MockEmbeddingProvider } from "@voicedesk/adapters";
import { describe, expect, it } from "vitest";
import { articleForPage, parseArticle, suggestionsFor, withTenantLinks } from "../src/articles";
import { HelpIndex } from "../src/search";

const calendar = parseArticle(`---
id: integrations
title: Connect your calendar - Google or Outlook
page: /t/:tenant/integrations
roles: owner, admin
keywords: calendar, google, outlook, booking
suggested: How do I connect Google Calendar? | Can I choose which calendar to use?
---
Bookings can go straight into your calendar.

## Connect Google Calendar
1. Open [Integrations](/t/:tenant/integrations).
2. Click **Connect Google Calendar**.

## Choose a calendar
Pick the calendar bookings should go into.
`);

const phone = parseArticle(`---
id: troubleshoot-phone
title: The phone isn't ringing
page: none
roles: all
keywords: phone, ringing, twilio, 32205, outbound
suggested: none
---
## Error 32205
Enable the Low Risk geo permission for the country in Twilio.
`);

const start = parseArticle(`---
id: getting-started
title: Getting started
page: /t/:tenant
roles: all
keywords: setup, first steps
suggested: Where do I start? | What should I set up first?
---
## Your first day
Approve your business profile first.
`);

describe("help articles", () => {
  it("parses front-matter and splits sections on ## headings", () => {
    expect(calendar).toMatchObject({
      id: "integrations",
      page: "/t/:tenant/integrations",
      roles: ["owner", "admin"],
      suggested: ["How do I connect Google Calendar?", "Can I choose which calendar to use?"],
    });
    expect(calendar.sections.map((s) => s.heading)).toEqual([
      "",
      "Connect Google Calendar",
      "Choose a calendar",
    ]);
    expect(phone.page).toBeNull();
    expect(phone.roles).toContain("staff");
    expect(phone.suggested).toEqual([]);
  });

  it("rejects malformed articles", () => {
    expect(() => parseArticle("no front-matter")).toThrow(/front-matter/);
    expect(() =>
      parseArticle(
        "---\nid: x\ntitle: t\npage: none\nroles: chef\nkeywords: a\nsuggested: none\n---\n",
      ),
    ).toThrow(/role/);
    expect(() =>
      parseArticle(
        "---\nid: x\ntitle: t\npage: none\nroles: all\nkeywords: a\nsuggested: none\nextra: 1\n---\n",
      ),
    ).toThrow(/unknown keys/);
  });

  it("finds the article for a screen, most specific first", () => {
    const all = [calendar, phone, start];
    expect(articleForPage("/t/abc/integrations", all)?.id).toBe("integrations");
    expect(articleForPage("/t/abc/integrations?calendar=connected", all)?.id).toBe("integrations");
    expect(articleForPage("/t/abc", all)?.id).toBe("getting-started");
    expect(suggestionsFor("/t/abc/integrations", all)).toEqual([
      "How do I connect Google Calendar?",
      "Can I choose which calendar to use?",
      "Where do I start?",
      "What should I set up first?",
    ]);
  });

  it("fills in the business id in links", () => {
    expect(withTenantLinks("[Integrations](/t/:tenant/integrations)", "t1")).toBe(
      "[Integrations](/t/t1/integrations)",
    );
  });
});

describe("HelpIndex", () => {
  const articles = [calendar, phone, start];

  it("ranks the right section with embeddings", async () => {
    const index = new HelpIndex(articles, () => Promise.resolve(new MockEmbeddingProvider()));
    const [top] = await index.search("how do I connect my google calendar");
    expect(top).toMatchObject({ articleId: "integrations", heading: "Connect Google Calendar" });
  });

  it("works on keywords alone and catches exact codes", async () => {
    const index = new HelpIndex(articles);
    const [top] = await index.search("twilio error 32205");
    expect(top).toMatchObject({ articleId: "troubleshoot-phone", heading: "Error 32205" });
    expect(await index.search("zzz qqq")).toEqual([]);
  });

  it("falls back to keywords when the embedding model fails", async () => {
    const index = new HelpIndex(articles, () => Promise.reject(new Error("model missing")));
    const [top] = await index.search("google calendar");
    expect(top?.articleId).toBe("integrations");
  });

  it("puts sections for the asker's role first", async () => {
    const index = new HelpIndex(articles);
    const hits = await index.search("calendar phone ringing", { role: "staff", limit: 5 });
    expect(hits[0]?.articleId).not.toBe("integrations");
  });
});
