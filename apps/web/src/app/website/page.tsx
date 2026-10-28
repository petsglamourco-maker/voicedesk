import type { Metadata } from "next";
import { SITE_NAME } from "@/components/site/brand";
import { Website } from "@/components/site/website";

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME}: AI receptionist for small businesses` },
  description:
    "An AI receptionist that answers your calls, chat, WhatsApp and email 24/7, books appointments and takes messages, for a fraction of the cost of hiring.",
};

/** The public website, viewable even when signed in (until it has its own domain). */
export default async function WebsitePage(props: { searchParams: Promise<{ currency?: string }> }) {
  const { currency } = await props.searchParams;
  return <Website currency={currency} path="/website" />;
}
