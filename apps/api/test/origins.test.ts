import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { parseExtraOrigins, registerOriginCheck } from "../src/lib/origin-check";

describe("EXTRA_WEB_ORIGINS (phone testing over home Wi-Fi)", () => {
  it("accepts https home-network addresses", () => {
    expect(parseExtraOrigins("https://192.168.1.20:8443, https://10.0.0.5:8443/x")).toEqual([
      "https://192.168.1.20:8443",
      "https://10.0.0.5:8443",
    ]);
    expect(parseExtraOrigins("https://my-pc.local:8443")).toEqual(["https://my-pc.local:8443"]);
    expect(parseExtraOrigins("")).toEqual([]);
  });

  it("refuses public sites, plain http and nonsense", () => {
    expect(() => parseExtraOrigins("https://evil.example.com")).toThrow(/home-network/);
    expect(() => parseExtraOrigins("https://8.8.8.8")).toThrow(/home-network/);
    expect(() => parseExtraOrigins("https://172.32.0.1")).toThrow(/home-network/);
    expect(() => parseExtraOrigins("http://192.168.1.20:8443")).toThrow(/https/);
    expect(() => parseExtraOrigins("not a url")).toThrow(/isn't a web address/);
  });

  it("the origin check lets changes through from the extra address only", async () => {
    const app = Fastify();
    registerOriginCheck(app, ["http://localhost:3000", "https://192.168.1.20:8443"]);
    app.post("/api/x", () => ({ ok: true }));
    const from = (origin: string) =>
      app.inject({ method: "POST", url: "/api/x", headers: { origin }, payload: {} });
    expect((await from("https://192.168.1.20:8443")).statusCode).toBe(200);
    expect((await from("http://localhost:3000")).statusCode).toBe(200);
    expect((await from("https://192.168.1.21:8443")).statusCode).toBe(403);
    await app.close();
  });
});
