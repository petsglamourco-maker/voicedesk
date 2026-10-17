import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlSite, type CrawledPage } from "../src/crawler";
import { BlockedUrlError, createSafeFetcher, isPublicAddress } from "../src/safe-fetch";

describe("isPublicAddress", () => {
  it.each([
    ["8.8.8.8", true],
    ["93.184.216.34", true],
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.16.0.1", false],
    ["172.32.0.1", true],
    ["192.168.1.10", false],
    ["169.254.169.254", false], // cloud metadata endpoint
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["::1", false],
    ["fe80::1", false],
    ["fd00::1", false],
    ["::ffff:127.0.0.1", false],
    ["2606:4700::1111", true],
  ])("%s → %s", (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

let server: Server;
let base: string;
const PAGE = (title: string, body: string, links: string[] = []) =>
  `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${body}</p>${links
    .map((l) => `<a href="${l}">${l}</a>`)
    .join("")}</main></body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    const send = (status: number, type: string, body: string) => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };
    const filler = "We are a friendly local business serving the community every day. ".repeat(3);
    switch (req.url) {
      case "/robots.txt":
        return send(200, "text/plain", "User-agent: *\nDisallow: /private\n");
      case "/sitemap.xml":
        return send(
          200,
          "application/xml",
          `<urlset><url><loc>${base}/from-sitemap</loc></url></urlset>`,
        );
      case "/":
        return send(
          200,
          "text/html",
          PAGE("Home", filler, [
            "/about",
            "/private/admin",
            "/logo.png",
            "http://elsewhere.invalid/x",
            "/moved",
          ]),
        );
      case "/about":
        return send(200, "text/html", PAGE("About us", filler, ["/"]));
      case "/from-sitemap":
        return send(200, "text/html", PAGE("Prices", filler));
      case "/private/admin":
        return send(200, "text/html", PAGE("Secret", filler));
      case "/moved":
        res.writeHead(301, { location: "/about" });
        return res.end();
      default:
        return send(404, "text/html", "not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("safe fetcher", () => {
  it("blocks private addresses by default (literal IPs and hostnames)", async () => {
    const safeFetch = createSafeFetcher();
    await expect(safeFetch(`${base}/`)).rejects.toThrow(BlockedUrlError);
    const port = (server.address() as AddressInfo).port;
    await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow();
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(BlockedUrlError);
    await expect(safeFetch("http://user:pass@example.com/")).rejects.toThrow(BlockedUrlError);
  });

  it("enforces the response size cap", async () => {
    const safeFetch = createSafeFetcher({ allowPrivateHosts: ["127.0.0.1"], maxBytes: 100 });
    await expect(safeFetch(`${base}/`)).rejects.toThrow(/exceeded|too large/);
  });
});

describe("crawlSite", () => {
  it("crawls same-site HTML, follows the sitemap and respects robots.txt", async () => {
    const pages: CrawledPage[] = [];
    const skipped: string[] = [];
    const result = await crawlSite(`${base}/`, {
      pageLimit: 10,
      delayMs: 0,
      fetch: createSafeFetcher({ allowPrivateHosts: ["127.0.0.1"] }),
      onPage: (p) => {
        pages.push(p);
      },
      onSkip: (url, reason) => skipped.push(`${url} ${reason}`),
    });
    const titles = pages.map((p) => p.title).sort();
    expect(titles).toEqual(["About us", "Home", "Prices"]);
    expect(skipped.some((s) => s.includes("/private/admin") && s.includes("robots"))).toBe(true);
    expect(result.visited.some((u) => u.includes("elsewhere"))).toBe(false);
    expect(result.visited.some((u) => u.endsWith(".png"))).toBe(false);
  });

  it("stops at the page limit", async () => {
    const result = await crawlSite(`${base}/`, {
      pageLimit: 1,
      delayMs: 0,
      fetch: createSafeFetcher({ allowPrivateHosts: ["127.0.0.1"] }),
    });
    expect(result.pages).toBe(1);
  });
});
