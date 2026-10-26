import { Card, CardHead, Progress, StatusPill } from "@voicedesk/ui";
import {
  CalendarCheck2,
  ChevronRight,
  Gauge,
  MessageCircleQuestion,
  MessageSquareReply,
  MessageSquareText,
  PhoneForwarded,
  PhoneMissed,
  PhoneOutgoing,
  StickyNote,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ScreenHero } from "@/components/screen-hero";
import { apiGetOrNull, type SpendCategory, type SpendView, type TodayView } from "@/lib/api";

export const metadata: Metadata = { title: "Today" };

const CATEGORIES: SpendCategory[] = ["calls", "sms", "ai"];

/** Today (ADR 0024): the day at a glance, built for a phone first. */
export default async function TodayPage(props: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await props.params;
  const today = await apiGetOrNull<TodayView>(`/api/tenants/${tenantId}/today`);
  if (!today) notFound();
  // Owners and admins also see the plan allowance (others get null).
  const spend = await apiGetOrNull<SpendView>(`/api/tenants/${tenantId}/spend`);
  const t = await getTranslations("today");
  const usage = await getTranslations("usage");
  const format = await getFormatter();
  const base = `/t/${tenantId}`;
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { timeStyle: "short", timeZone: today.timezone });
  const dateLabel = format.dateTime(new Date(`${today.date}T12:00:00Z`), {
    dateStyle: "full",
    timeZone: "UTC",
  });

  const chips = [
    {
      href: `${base}/inbox`,
      label: t("chips.chats"),
      n: today.waitingChats.count,
      Icon: MessageSquareText,
      tone: "warning" as const,
    },
    {
      href: `${base}/calls`,
      label: t("chips.missed"),
      n: today.missedCalls.count,
      Icon: PhoneMissed,
      tone: "danger" as const,
    },
    {
      href: `${base}/calls`,
      label: t("chips.missedByTeam"),
      n: today.missedByTeam.count,
      Icon: PhoneForwarded,
      tone: "info" as const,
    },
    {
      href: `${base}/calls`,
      label: t("chips.followUps", { booked: today.followUps.booked }),
      n: today.followUps.sent,
      Icon: MessageSquareReply,
      tone: "success" as const,
    },
    {
      href: `${base}/knowledge#questions`,
      label: t("chips.questions"),
      n: today.questionsToAnswer.count,
      Icon: MessageCircleQuestion,
      tone: "warning" as const,
    },
    {
      href: `${base}/records`,
      label: t("chips.messages"),
      n: today.messages.count,
      Icon: StickyNote,
      tone: "info" as const,
    },
    {
      href: `${base}/calls`,
      label: t("chips.callbacks"),
      n: today.callbacks.count,
      Icon: PhoneOutgoing,
      tone: "info" as const,
    },
  ];

  return (
    <div className="stagger space-y-6">
      <ScreenHero icon="today" eyebrow={dateLabel} title={t("title")} description={t("subtitle")} />

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="today-chips">
        {chips.map(({ href, label, n, Icon, tone }) => (
          <li key={label}>
            <Link
              href={href}
              className="glass flex min-h-20 items-center gap-3 rounded-lg p-4 transition-colors hover:border-input"
            >
              <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">
                <span className="block font-display text-2xl font-semibold tabular-nums">{n}</span>
                <span className="block truncate text-xs text-muted-foreground">{label}</span>
              </span>
              {n > 0 ? <StatusPill className="ms-auto" tone={tone} label={t("todo")} /> : null}
            </Link>
          </li>
        ))}
      </ul>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHead icon={<CalendarCheck2 />} title={t("bookings.title")} />
          {today.bookings.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("bookings.none")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-border" data-testid="today-bookings">
              {today.bookings.map((b) => (
                <li key={b.id} className="flex items-center gap-3 py-3">
                  <span className="w-16 shrink-0 font-display font-semibold tabular-nums">
                    {time(b.startsAt)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium" dir="auto">
                      {b.customerName ?? t("bookings.noName")}
                    </span>
                    {b.service ? (
                      <span className="block truncate text-xs text-muted-foreground" dir="auto">
                        {b.service}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead icon={<MessageSquareText />} title={t("chats.title")} />
          <List
            empty={t("chats.none")}
            items={today.waitingChats.items.map((c) => ({
              key: c.id,
              href: `${base}/inbox/${c.id}`,
              title: c.displayName ?? t("chats.unknown"),
              detail: `${t(`channels.${c.channel}`)} · ${time(c.lastMessageAt)}`,
            }))}
          />
        </Card>

        <Card>
          <CardHead icon={<PhoneMissed />} title={t("missed.title")} />
          <List
            empty={t("missed.none")}
            items={today.missedCalls.items.map((m) => ({
              key: m.conversationId,
              href: `${base}/calls/${m.conversationId}`,
              title: m.urgent ? t("missed.urgent") : t("missed.call"),
              detail: time(m.at),
            }))}
          />
        </Card>

        <Card>
          <CardHead icon={<StickyNote />} title={t("messages.title")} />
          <List
            empty={t("messages.none")}
            items={today.messages.items.map((m) => ({
              key: m.id,
              href: `${base}/records`,
              title: m.callerName ?? t("messages.unknown"),
              detail: m.reason,
              urgent: m.urgency === "urgent",
            }))}
            urgentLabel={t("messages.urgent")}
          />
        </Card>
      </div>

      {spend ? (
        <Card data-testid="today-allowance">
          <CardHead
            icon={<Gauge />}
            title={t("allowance.title")}
            aside={
              <Link href={`${base}/usage`} className="text-sm font-semibold text-primary">
                {t("allowance.details")}
              </Link>
            }
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {CATEGORIES.map((c) => {
              const { spent, cap } = spend.categories[c];
              return (
                <div key={c}>
                  <div className="flex justify-between text-sm">
                    <span>{usage(`categories.${c}`)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0}%
                    </span>
                  </div>
                  <Progress
                    className="mt-2"
                    value={spent}
                    max={Math.max(cap, 1)}
                    label={usage("progressLabel", { what: usage(`categories.${c}`) })}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function List(props: {
  empty: string;
  items: Array<{ key: string; href: string; title: string; detail: string; urgent?: boolean }>;
  urgentLabel?: string;
}): ReactNode {
  if (props.items.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">{props.empty}</p>;
  }
  return (
    <ul className="mt-3 divide-y divide-border">
      {props.items.map((item) => (
        <li key={item.key}>
          <Link href={item.href} className="flex min-h-14 items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium" dir="auto">
                  {item.title}
                </span>
                {item.urgent && props.urgentLabel ? (
                  <StatusPill tone="danger" label={props.urgentLabel} />
                ) : null}
              </span>
              <span className="block truncate text-xs text-muted-foreground" dir="auto">
                {item.detail}
              </span>
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
