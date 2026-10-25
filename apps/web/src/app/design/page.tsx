import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getMe } from "@/lib/api";
import { THEME_COOKIE } from "@/lib/theme";
import { Gallery } from "./gallery";
import { GALLERY_LABELS, type GalleryLabels } from "./labels";

/**
 * Design system gallery (DESIGN.md): every token and component. Platform owner only in
 * production; any signed-in user in development (so e2e can use throwaway accounts).
 */
export default async function DesignPage() {
  const me = await getMe();
  if (!me) redirect("/sign-in?redirect=/design");
  if (!me.user.isPlatformOwner && process.env.NODE_ENV === "production") notFound();
  const t = await getTranslations("design");
  const labels = Object.fromEntries(GALLERY_LABELS.map((k) => [k, t(k)])) as GalleryLabels;
  const light = (await cookies()).get(THEME_COOKIE)?.value === "light";
  return <Gallery labels={labels} initialMode={light ? "light" : "dark"} />;
}
