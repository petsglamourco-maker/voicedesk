// Seeds local dev data: a platform owner and two demo businesses. Idempotent.
import { loadRootEnv, requireEnv } from "@voicedesk/config/load-env";
import { createBusinessSchema, createTenantProfile } from "@voicedesk/core";
import { closeDb, createDb, user } from "@voicedesk/db";
import { eq } from "drizzle-orm";
import { createAppAuth } from "./container";
import { parseEnv } from "./env";

loadRootEnv();
const env = parseEnv();
const email = requireEnv("PLATFORM_OWNER_EMAIL");
const password = requireEnv("PLATFORM_OWNER_PASSWORD");

const db = createDb(env.DATABASE_URL);
const auth = createAppAuth(env, db, () => Promise.resolve()); // no emails during seeding

try {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing) {
    console.log(`Seed: platform owner ${email} already exists — nothing to do.`);
  } else {
    const { user: owner } = await auth.api.signUpEmail({
      body: { name: "Platform Owner", email, password },
    });
    await db
      .update(user)
      .set({ emailVerified: true, isPlatformOwner: true })
      .where(eq(user.id, owner.id));

    for (const demo of [
      { name: "Bright Dental (demo)", slug: "bright-dental-demo" },
      { name: "Northside Plumbing (demo)", slug: "northside-plumbing-demo" },
    ]) {
      const org = await auth.api.createOrganization({ body: { ...demo, userId: owner.id } });
      if (!org) throw new Error(`failed to create ${demo.name}`);
      await createTenantProfile(db, {
        tenantId: org.id,
        actorUserId: owner.id,
        input: createBusinessSchema.parse({
          name: demo.name,
          countryCode: "GB",
          timezone: "Europe/London",
          defaultLanguage: "en",
        }),
      });
    }
    console.log(`Seed: created platform owner ${email} and 2 demo businesses.`);
  }
} finally {
  await closeDb(db);
}
