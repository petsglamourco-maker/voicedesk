import { Card, CardHead, HeroStat, PageHero, StatusPill, type StatusTone } from "@voicedesk/ui";
import {
  BrainCircuit,
  CalendarCheck2,
  CheckCircle2,
  CircleDashed,
  Globe2,
  Laptop,
  LifeBuoy,
  Mail,
  MailOpen,
  MessageSquareText,
  Mic,
  Phone,
  PhoneOutgoing,
  Settings2,
  ShieldCheck,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { WhatsAppIcon } from "@/components/shell/icons";
import { apiGetOrNull } from "@/lib/api";

export const metadata: Metadata = { title: "Setup" };

type State = "ready" | "local" | "off";
interface SetupItem {
  id: string;
  state: State;
  missing: string[];
  paid: boolean;
}

const ICON: Record<string, LucideIcon | typeof WhatsAppIcon> = {
  ai: BrainCircuit,
  voice: Mic,
  phone: Phone,
  email: Mail,
  sms: MessageSquareText,
  googleCalendar: CalendarCheck2,
  microsoftCalendar: CalendarCheck2,
  mailbox: MailOpen,
  whatsapp: WhatsAppIcon,
  outbound: PhoneOutgoing,
  botCheck: ShieldCheck,
  billing: CreditCard,
  publicAddress: Globe2,
};

const TONE: Record<State, [StatusTone, LucideIcon, string]> = {
  ready: ["success", CheckCircle2, "var(--color-success)"],
  local: ["info", Laptop, "var(--color-info)"],
  off: ["warning", CircleDashed, "var(--color-warning)"],
};

/** Platform admin → Setup: which features are ready and what each still needs (names only). */
export default async function SetupPage() {
  const [data, support] = await Promise.all([
    apiGetOrNull<{ items: SetupItem[] }>("/api/platform/setup"),
    apiGetOrNull<{ requests: unknown[] }>("/api/platform/support-requests?status=open"),
  ]);
  if (!data) notFound();
  const t = await getTranslations("setup");
  const platform = await getTranslations("platform");
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  const count = (s: State) => data.items.filter((i) => i.state === s).length;
  // Not-set-up first, then this-computer-only, then ready.
  const order: Record<State, number> = { off: 0, local: 1, ready: 2 };
  const items = [...data.items].sort((a, b) => order[a.state] - order[b.state]);

  return (
    <>
      <PageHero
        icon={<Settings2 />}
        eyebrow={platform("badge")}
        title={t("title")}
        description={t("subtitle")}
      >
        <HeroStat
          icon={<CheckCircle2 />}
          label={t("readyCount")}
          value={count("ready")}
          color="var(--color-success)"
        />
        <HeroStat
          icon={<Laptop />}
          label={t("localCount")}
          value={count("local")}
          color="var(--color-info)"
        />
        <HeroStat
          icon={<CircleDashed />}
          label={t("offCount")}
          value={count("off")}
          color="var(--color-warning)"
        />
        <HeroStat
          icon={<LifeBuoy />}
          label={t("openSupport")}
          value={support?.requests.length ?? 0}
          color="var(--color-accent)"
        />
      </PageHero>

      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0" data-testid="setup-items">
        {items.map((item) => {
          const Icon = ICON[item.id] ?? Settings2;
          const [tone, StateIcon, color] = TONE[item.state];
          const key = item.id as "ai";
          return (
            <Card
              key={item.id}
              data-testid={`setup-${item.id}`}
              className={item.state === "ready" ? "border-success/30" : undefined}
            >
              <CardHead
                icon={<Icon />}
                title={t(`items.${key}.name`)}
                hint={t(`items.${key}.unlocks`)}
                color={color}
                aside={<StatusPill tone={tone} icon={StateIcon} label={t(`state.${item.state}`)} />}
              />
              {item.state !== "ready" ? (
                <div className="mt-4 space-y-3 border-t border-border pt-4 text-sm">
                  <p className="leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground">{t("how")}: </span>
                    {t(`items.${key}.how`, { origin })}
                  </p>
                  {item.missing.length ? (
                    <p className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {t("needs")}
                      </span>
                      {item.missing.map((m) =>
                        m === "AI_PROVIDER_ON" ? (
                          <span key={m} className="text-xs">
                            {t("aiProviderOn")}
                          </span>
                        ) : (
                          <code
                            key={m}
                            className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                          >
                            {m}
                          </code>
                        ),
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">
                {item.paid ? t("paid") : t("free")}
              </p>
            </Card>
          );
        })}
      </div>
    </>
  );
}
