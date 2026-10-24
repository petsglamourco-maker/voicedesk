import { user } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHarness,
  ORIGIN,
  signUpVerified,
  makePlatformOwner,
  type TestHarness,
} from "./harness";

interface View {
  id: string;
  key: string;
  enabled: boolean;
  priority: number;
  apiKeyHint: string | null;
  ready: boolean;
}

let h: TestHarness;
let owner: { email: string; cookie: string };
let regular: { email: string; cookie: string };

beforeAll(async () => {
  h = await createHarness();
  owner = await signUpVerified(h, "Platform");
  regular = await signUpVerified(h, "Regular");
  await makePlatformOwner(h, owner);
});

afterAll(() => h.close());

const headers = (who: { cookie: string }) => ({ cookie: who.cookie, origin: ORIGIN });
const list = async () =>
  (
    await h.app.inject({
      method: "GET",
      url: "/api/platform/ai-providers",
      headers: headers(owner),
    })
  ).json<{ providers: View[]; encryptionConfigured: boolean }>();

describe("platform AI provider settings API", () => {
  it("is invisible to anyone but the platform owner", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/platform/ai-providers",
      headers: headers(regular),
    });
    expect(res.statusCode).toBe(404);
    const anon = await h.app.inject({ method: "GET", url: "/api/platform/ai-providers" });
    expect(anon.statusCode).toBe(401);
  });

  it("requires two-step login before the platform owner can use it (audit C1)", async () => {
    const noMfa = await signUpVerified(h, "PlatformNoMfa");
    await h.db.update(user).set({ isPlatformOwner: true }).where(eq(user.email, noMfa.email));
    const res = await h.app.inject({
      method: "GET",
      url: "/api/platform/ai-providers",
      headers: headers(noMfa),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "MFA_REQUIRED" });
    const me = await h.app.inject({ method: "GET", url: "/api/me", headers: headers(noMfa) });
    expect(me.json()).toMatchObject({ mfa: { required: true } });
  });

  it("lists providers in priority order without exposing secrets", async () => {
    const res = await h.app.inject({
      method: "GET",
      url: "/api/platform/ai-providers",
      headers: headers(owner),
    });
    expect(res.payload).not.toContain("apiKeyEncrypted");
    const body = res.json<{ providers: View[]; encryptionConfigured: boolean }>();
    expect(body.encryptionConfigured).toBe(true);
    expect(body.providers.map((p) => p.key)).toEqual(
      expect.arrayContaining(["anthropic", "deepseek", "local"]),
    );
  });

  it("stores an API key and only returns a hint", async () => {
    const claude = (await list()).providers.find((p) => p.key === "anthropic")!;
    const res = await h.app.inject({
      method: "PUT",
      url: `/api/platform/ai-providers/${claude.id}`,
      headers: headers(owner),
      payload: { apiKey: "sk-ant-secret-value-9876" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain("secret-value");
    expect(res.json<View>()).toMatchObject({ apiKeyHint: "sk-…9876", ready: true });

    const cleared = await h.app.inject({
      method: "PUT",
      url: `/api/platform/ai-providers/${claude.id}`,
      headers: headers(owner),
      payload: { apiKey: "" },
    });
    expect(cleared.json<View>().apiKeyHint).toBeNull();
  });

  it("validates updates and the priority order", async () => {
    const providers = (await list()).providers;
    const bad = await h.app.inject({
      method: "PUT",
      url: `/api/platform/ai-providers/${providers[0]!.id}`,
      headers: headers(owner),
      payload: { baseUrl: "ftp://example.com" },
    });
    expect(bad.statusCode).toBe(400);

    const partial = await h.app.inject({
      method: "POST",
      url: "/api/platform/ai-providers/order",
      headers: headers(owner),
      payload: { ids: [providers[0]!.id] },
    });
    expect(partial.statusCode).toBe(400);

    const same = await h.app.inject({
      method: "POST",
      url: "/api/platform/ai-providers/order",
      headers: headers(owner),
      payload: { ids: providers.map((p) => p.id) },
    });
    expect(same.statusCode).toBe(200);
    expect(same.json<{ providers: View[] }>().providers.map((p) => p.id)).toEqual(
      providers.map((p) => p.id),
    );
  });
});
