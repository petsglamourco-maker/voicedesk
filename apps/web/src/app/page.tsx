import { redirect } from "next/navigation";
import { getMe } from "@/lib/api";

/** Entry point: route the user to sign-in, onboarding, or their business. */
export default async function Home() {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  if (me.tenants.length === 0) redirect("/onboarding");
  const active = me.tenants.find((t) => t.tenantId === me.activeTenantId) ?? me.tenants[0]!;
  redirect(`/t/${active.tenantId}`);
}
