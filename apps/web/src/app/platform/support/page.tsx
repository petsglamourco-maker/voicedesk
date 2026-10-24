import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  HeroStat,
  PageHero,
  StatusPill,
  buttonVariants,
} from "@voicedesk/ui";
import { Building2, CheckCircle2, CircleDot, Inbox, LifeBuoy, Mail, Monitor } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { apiGetOrNull } from "@/lib/api";
import { ResolveButton } from "./resolve-button";

export const metadata: Metadata = { title: "Support requests" };

interface SupportRequest {
  id: string;
  status: "open" | "resolved";
  page: string;
  message: string;
  chat: Array<{ role: "user" | "assistant"; text: string }> | null;
  createdAt: string;
  resolvedAt: string | null;
  from: { name: string; email: string };
  business: string | null;
}

/** Platform admin → Support requests: "Contact support" messages from the Help assistant. */
export default async function SupportRequestsPage() {
  const data = await apiGetOrNull<{ requests: SupportRequest[] }>("/api/platform/support-requests");
  if (!data) notFound();
  const t = await getTranslations("supportRequests");
  const platform = await getTranslations("platform");
  const format = await getFormatter();
  const now = new Date();
  const open = data.requests.filter((r) => r.status === "open");
  const resolved = data.requests.filter((r) => r.status === "resolved");

  return (
    <>
      <PageHero
        icon={<LifeBuoy />}
        eyebrow={platform("badge")}
        title={t("title")}
        description={t("subtitle")}
      >
        <HeroStat
          icon={<CircleDot />}
          label={t("open")}
          value={open.length}
          color="var(--color-warning)"
        />
        <HeroStat
          icon={<CheckCircle2 />}
          label={t("resolved")}
          value={resolved.length}
          color="var(--color-success)"
        />
      </PageHero>

      {data.requests.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title={t("empty")} description={t("emptyHint")} />
        </Card>
      ) : (
        <ul className="space-y-3" data-testid="support-requests">
          {[...open, ...resolved].map((r) => (
            <li key={r.id}>
              <Card className={r.status === "open" ? "border-warning/30" : "opacity-80"}>
                <div className="flex flex-wrap items-start gap-3">
                  <Avatar name={r.from.name} />
                  <div className="min-w-0 flex-1">
                    <p className="font-display font-semibold" dir="auto">
                      {r.from.name}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span dir="ltr">{r.from.email}</span>
                      {r.business ? (
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="size-3" aria-hidden />
                          <span dir="auto">{r.business}</span>
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1">
                        <Monitor className="size-3" aria-hidden />
                        <code className="font-mono">{r.page}</code>
                      </span>
                      <time dateTime={r.createdAt}>
                        {format.relativeTime(new Date(r.createdAt), now)}
                      </time>
                    </p>
                  </div>
                  {r.status === "open" ? (
                    <StatusPill tone="warning" icon={CircleDot} label={t("open")} live />
                  ) : (
                    <StatusPill tone="success" icon={CheckCircle2} label={t("resolved")} />
                  )}
                </div>
                <p className="mt-4 text-sm whitespace-pre-wrap" dir="auto">
                  {r.message}
                </p>
                {r.chat?.length ? (
                  <details className="mt-3 rounded-lg border border-border px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-medium">
                      {t("chat", { n: r.chat.length })}
                    </summary>
                    <ul className="mt-2 space-y-2">
                      {r.chat.map((turn, i) => (
                        <li key={i} className="flex gap-2">
                          <Badge tone={turn.role === "user" ? "secondary" : "accent"}>
                            {turn.role === "user" ? t("them") : t("assistant")}
                          </Badge>
                          <span className="min-w-0 flex-1 whitespace-pre-wrap" dir="auto">
                            {turn.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={`mailto:${encodeURIComponent(r.from.email)}?subject=${encodeURIComponent(t("replySubject"))}`}
                    className={buttonVariants({ variant: "secondary", size: "sm" })}
                  >
                    <Mail aria-hidden />
                    {t("reply")}
                  </a>
                  <ResolveButton
                    id={r.id}
                    status={r.status}
                    labels={{ resolve: t("markResolved"), reopen: t("reopen") }}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
