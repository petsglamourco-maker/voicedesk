import {
  Card,
  EmptyState,
  HeroStat,
  PageHero,
  StatusPill,
  buttonVariants,
  type StatusTone,
} from "@voicedesk/ui";
import { CalendarDays, Coins, ExternalLink, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { apiGetOrNull } from "@/lib/api";
import { DemoSettingsForm, ForgetLeadButton } from "./demo-controls";

export const metadata: Metadata = { title: "Demos" };

interface Overview {
  settings: { enabled: boolean; dailyLimit: number };
  today: number;
  monthCostUsd: number;
  requests: Array<{
    id: string;
    website: string;
    businessName: string | null;
    email: string | null;
    status: string;
    costUsd: number | null;
    createdAt: string;
    purgedAt: string | null;
  }>;
}

const TONE: Record<string, StatusTone> = {
  ready: "success",
  crawling: "info",
  building: "info",
  failed: "danger",
};

/** Platform admin → Demos (ADR 0029): the /try switch, daily limit, spend and leads. */
export default async function DemosPage() {
  const data = await apiGetOrNull<Overview>("/api/platform/demos");
  if (!data) notFound();
  const t = await getTranslations("platformDemos");
  const platform = await getTranslations("platform");
  const format = await getFormatter();
  return (
    <>
      <PageHero
        icon={<Sparkles />}
        eyebrow={platform("badge")}
        title={t("title")}
        description={t("subtitle")}
      >
        <HeroStat
          icon={<CalendarDays />}
          label={t("today")}
          value={`${data.today} / ${data.settings.dailyLimit}`}
          color="var(--color-primary)"
        />
        <HeroStat
          icon={<Coins />}
          label={t("monthCost")}
          value={format.number(data.monthCostUsd, { style: "currency", currency: "USD" })}
          color="var(--color-warning)"
        />
      </PageHero>

      <Card>
        <DemoSettingsForm
          initial={data.settings}
          labels={{
            enabled: t("enabled"),
            dailyLimit: t("dailyLimit"),
            save: t("save"),
            saved: t("saved"),
          }}
        />
        <Link
          href="/try"
          target="_blank"
          className={buttonVariants({ variant: "ghost", size: "sm", className: "mt-3" })}
        >
          <ExternalLink aria-hidden />
          {t("open")}
        </Link>
      </Card>

      <Card>
        <h2 className="font-display text-lg font-semibold">{t("list")}</h2>
        {data.requests.length === 0 ? (
          <EmptyState className="mt-4" icon={Sparkles} title={t("none")} />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm" data-testid="demo-list">
              <thead className="text-start text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 text-start font-medium">{t("website")}</th>
                  <th className="py-2 text-start font-medium">{t("status")}</th>
                  <th className="py-2 text-start font-medium">{t("lead")}</th>
                  <th className="py-2 text-end font-medium">{t("cost")}</th>
                  <th className="py-2 text-end font-medium">{t("created")}</th>
                </tr>
              </thead>
              <tbody>
                {data.requests.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="max-w-56 truncate py-2 pe-3" dir="auto">
                      {r.businessName ?? r.website}
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.website}
                      </span>
                    </td>
                    <td className="py-2 pe-3">
                      <StatusPill
                        tone={r.purgedAt ? "info" : (TONE[r.status] ?? "info")}
                        label={r.purgedAt ? t("deleted") : r.status}
                      />
                    </td>
                    <td className="py-2 pe-3">
                      {r.email ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate">{r.email}</span>
                          <ForgetLeadButton id={r.id} label={t("forget")} />
                        </span>
                      ) : (
                        t("noEmail")
                      )}
                    </td>
                    <td className="tabular py-2 text-end">
                      {r.costUsd === null
                        ? "…"
                        : format.number(r.costUsd, { style: "currency", currency: "USD" })}
                    </td>
                    <td className="tabular py-2 text-end text-muted-foreground">
                      {format.dateTime(new Date(r.createdAt), {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
