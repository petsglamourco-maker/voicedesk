import { redirect } from "next/navigation";
import { getMe } from "@/lib/api";

/** The installed app's start page (manifest start_url): Today for the active business. */
export default async function TodayEntry() {
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect=/today");
  if (me.tenants.length === 0) redirect("/onboarding");
  const active = me.tenants.find((t) => t.tenantId === me.activeTenantId) ?? me.tenants[0]!;
  redirect(`/t/${active.tenantId}/today`);
}
