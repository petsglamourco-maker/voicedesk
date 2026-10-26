import { AuroraBackground, Badge, buttonVariants, cn } from "@voicedesk/ui";
import {
  ArrowRight,
  BarChart3,
  CalendarCheck2,
  Check,
  Clock3,
  Coffee,
  Headset,
  Languages,
  Layers3,
  MessageSquareText,
  MessagesSquare,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  Plane,
  Repeat2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { SITE_NAME } from "./brand";
import { SavingsCalculator, type SitePlan } from "./savings-calculator";
import { receptionistCost, NATIONAL_LIVING_WAGE, FULL_TIME_HOURS } from "./savings";

export interface PublicPlan extends SitePlan {
  minutes: number;
  texts: number;
  phoneNumbers: number;
  seats: number;
  features: string[];
}

const pounds = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(Math.round(value));

const FEATURES: Array<{ key: string; icon: LucideIcon; color: string }> = [
  { key: "calls", icon: PhoneCall, color: "var(--color-ch-voice)" },
  { key: "bookings", icon: CalendarCheck2, color: "var(--color-success)" },
  { key: "messages", icon: MessageSquareText, color: "var(--color-ch-email)" },
  { key: "transfers", icon: PhoneForwarded, color: "var(--color-ch-outbound)" },
  { key: "backup", icon: PhoneIncoming, color: "var(--color-secondary)" },
  { key: "menu", icon: Layers3, color: "var(--color-accent)" },
  { key: "channels", icon: MessagesSquare, color: "var(--color-ch-whatsapp)" },
  { key: "followups", icon: Repeat2, color: "var(--color-primary)" },
  { key: "languages", icon: Languages, color: "var(--color-info)" },
  { key: "reports", icon: BarChart3, color: "var(--color-warning)" },
  { key: "reviews", icon: Star, color: "var(--color-ch-form)" },
  { key: "mobile", icon: Smartphone, color: "var(--color-secondary)" },
];

function Section(props: {
  id?: string;
  title: string;
  lead?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={props.id}
      aria-labelledby={props.id ? `${props.id}-title` : undefined}
      className={cn(
        "mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 sm:px-6 sm:py-20",
        props.className,
      )}
    >
      <h2
        id={props.id ? `${props.id}-title` : undefined}
        className="max-w-3xl font-display text-[28px] leading-tight font-semibold tracking-tight sm:text-4xl"
      >
        {props.title}
      </h2>
      {props.lead ? (
        <p className="mt-3 max-w-2xl text-[17px] text-muted-foreground">{props.lead}</p>
      ) : null}
      <div className="mt-10">{props.children}</div>
    </section>
  );
}

function IconChip(props: { icon: LucideIcon; color: string }) {
  const Icon = props.icon;
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-lg"
      style={{
        color: props.color,
        background: `color-mix(in srgb, ${props.color} 14%, transparent)`,
        boxShadow: `0 0 22px -8px ${props.color}`,
      }}
    >
      <Icon className="size-5" />
    </span>
  );
}

/** The public Ringwise website (ADR 0030): what it does, what it saves, what it costs. */
export async function Landing(props: { plans: PublicPlan[]; trialDays: number; demos: boolean }) {
  const t = await getTranslations("site");
  const name = SITE_NAME;
  const cheapest = props.plans.reduce<number | null>(
    (min, p) => (min === null || p.pricePence < min ? p.pricePence : min),
    null,
  );
  const growth = props.plans.find((p) => p.id === "growth");
  const person = receptionistCost({
    hourlyPay: NATIONAL_LIVING_WAGE,
    hoursPerWeek: FULL_TIME_HOURS,
    includeNationalInsurance: true,
  });
  const primaryCta = props.demos
    ? { href: "/try", label: t("hero.try") }
    : { href: "/sign-up", label: t("hero.start") };

  return (
    <div className="relative overflow-x-clip">
      <AuroraBackground intensity="vivid" />

      {/* Header */}
      <header className="glass sticky top-0 z-30 border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_22px_-4px_var(--color-glow)]"
            >
              <PhoneCall className="size-4" />
            </span>
            {name}
          </Link>
          <nav aria-label={name} className="ms-6 hidden items-center gap-5 text-sm md:flex">
            <a href="#how" className="text-muted-foreground hover:text-foreground">
              {t("nav.how")}
            </a>
            <a href="#features" className="text-muted-foreground hover:text-foreground">
              {t("nav.features")}
            </a>
            <a href="#savings" className="text-muted-foreground hover:text-foreground">
              {t("nav.savings")}
            </a>
            <a href="#pricing" className="text-muted-foreground hover:text-foreground">
              {t("nav.pricing")}
            </a>
            <a href="#faq" className="text-muted-foreground hover:text-foreground">
              {t("nav.faq")}
            </a>
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <Link href="/sign-in" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {t("nav.signIn")}
            </Link>
            <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>
              {t("nav.start")}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="relative">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
          <Badge tone="primary">
            <Sparkles aria-hidden />
            {t("hero.eyebrow")}
          </Badge>
          <h1 className="mt-5 max-w-4xl font-display text-[40px] leading-[1.05] font-semibold tracking-tight sm:text-6xl">
            <span className="text-aurora">{t("hero.title")}</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            {t("hero.lead", { name, price: cheapest === null ? "£29" : pounds(cheapest / 100) })}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={primaryCta.href}
              className={buttonVariants({ size: "lg", className: "h-12 px-6 text-base" })}
              data-testid="hero-cta"
            >
              {primaryCta.label}
              <ArrowRight aria-hidden />
            </Link>
            {props.demos ? (
              <Link
                href="/sign-up"
                className={buttonVariants({ variant: "secondary", size: "lg", className: "h-12" })}
              >
                {t("hero.start")}
              </Link>
            ) : null}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {props.demos ? `${t("hero.tryHint")} ` : ""}
            {t("hero.from", { days: props.trialDays })}
          </p>
          <p className="mt-8 flex max-w-2xl items-start gap-2 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            {t("hero.trust")}
          </p>
        </section>

        {/* The problem */}
        <Section title={t("problem.title")} lead={t("problem.lead")}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["busy", Users],
                ["closed", Clock3],
                ["holiday", Plane],
                ["rush", Coffee],
              ] as const
            ).map(([key, Icon]) => (
              <li
                key={key}
                className="glass flex items-center gap-3 rounded-xl border border-border p-4"
              >
                <Icon className="size-5 shrink-0 text-warning" aria-hidden />
                <span className="font-medium">{t(`problem.points.${key}`)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 font-display text-xl font-semibold text-primary">
            {t("problem.answer", { name })}
          </p>
        </Section>

        {/* Features */}
        <Section id="features" title={t("features.title")} lead={t("features.lead")}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.key} className="glass rounded-xl border border-border p-5">
                <div className="flex items-center gap-3">
                  <IconChip icon={f.icon} color={f.color} />
                  <h3 className="font-display font-semibold">
                    {t(`features.items.${f.key}.title`)}
                  </h3>
                </div>
                <p className="mt-3 text-[15px] text-muted-foreground">
                  {t(`features.items.${f.key}.text`, { name })}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        {/* How it works */}
        <Section id="how" title={t("how.title")}>
          <ol className="grid gap-4 md:grid-cols-3">
            {(["learn", "check", "go"] as const).map((step, i) => (
              <li key={step} className="glass aurora-border relative rounded-xl p-6">
                <span className="tabular font-display text-3xl font-semibold text-primary">
                  {i + 1}
                </span>
                <h3 className="mt-2 font-display text-lg font-semibold">
                  {t(`how.steps.${step}.title`)}
                </h3>
                <p className="mt-2 text-[15px] text-muted-foreground">
                  {t(`how.steps.${step}.text`, { name })}
                </p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Savings */}
        <Section id="savings" title={t("savings.title")} lead={t("savings.lead")}>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[34rem] text-start text-[15px]">
              <caption className="sr-only">{t("savings.table.label")}</caption>
              <thead className="bg-[color-mix(in_srgb,var(--color-surface)_70%,transparent)] text-sm">
                <tr>
                  <th scope="col" className="p-4 text-start font-medium text-muted-foreground">
                    <span className="sr-only">{t("savings.table.label")}</span>
                  </th>
                  <th
                    scope="col"
                    className="p-4 text-start font-display font-semibold text-primary"
                  >
                    {t("savings.table.ringwise", { name })}
                  </th>
                  <th scope="col" className="p-4 text-start font-display font-semibold">
                    {t("savings.table.person")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(["hours", "cover", "calls", "cost", "hiring"] as const).map((row) => (
                  <tr key={row} className="border-t border-border">
                    <th scope="row" className="p-4 text-start font-medium">
                      {t(`savings.table.${row}`)}
                    </th>
                    <td className="p-4">
                      <span className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                        {t(`savings.table.${row}Ringwise`, {
                          price: growth ? pounds(growth.pricePence / 100) : "£79",
                        })}
                      </span>
                    </td>
                    <td className="p-4 text-muted-foreground">
                      {t(`savings.table.${row}Person`, { price: pounds(person.perMonth) })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-8">
            <SavingsCalculator
              plans={props.plans.map((p) => ({ id: p.id, name: p.name, pricePence: p.pricePence }))}
            />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{t("savings.sources")}</p>
        </Section>

        {/* Value beyond cost */}
        <Section title={t("value.title")}>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(["never", "consistent", "record", "grow"] as const).map((key) => (
              <li key={key} className="glass rounded-xl border border-border p-5">
                <h3 className="font-display font-semibold">{t(`value.items.${key}.title`)}</h3>
                <p className="mt-2 text-[15px] text-muted-foreground">
                  {t(`value.items.${key}.text`)}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        {/* Pricing */}
        <Section
          id="pricing"
          title={t("pricing.title")}
          lead={t("pricing.lead", { days: props.trialDays })}
        >
          <ul className="grid gap-4 md:grid-cols-3" data-testid="pricing">
            {props.plans.map((plan) => {
              const popular = plan.id === "growth";
              return (
                <li
                  key={plan.id}
                  className={cn(
                    "glass relative flex flex-col rounded-xl border p-6",
                    popular
                      ? "aurora-border border-primary/50 shadow-[0_24px_80px_-24px_var(--color-glow)]"
                      : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-xl font-semibold">{plan.name}</h3>
                    {popular ? <Badge tone="primary">{t("pricing.popular")}</Badge> : null}
                  </div>
                  <p className="mt-4">
                    <span className="tabular font-display text-4xl font-semibold">
                      {pounds(plan.pricePence / 100)}
                    </span>
                    <span className="text-muted-foreground">{t("pricing.perMonth")}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{t("pricing.exVat")}</p>
                  <ul className="mt-5 flex-1 space-y-2 text-[15px]">
                    {[
                      t("pricing.minutes", { n: plan.minutes }),
                      t("pricing.texts", { n: plan.texts }),
                      t("pricing.numbers", { n: plan.phoneNumbers }),
                      t("pricing.seats", { n: plan.seats }),
                      t("pricing.coreFeatures"),
                      ...(plan.features.length ? [t("pricing.allFeatures")] : []),
                    ].map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                        {line}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/sign-up"
                    className={buttonVariants({
                      variant: popular ? "primary" : "secondary",
                      className: "mt-6 w-full",
                    })}
                  >
                    {t("pricing.choose")}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">{t("pricing.allowance")}</p>
        </Section>

        {/* Trust */}
        <Section title={t("trust.title")}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {(["ai", "approved", "recording", "cards", "recordings", "security"] as const).map(
              (key) => (
                <li key={key} className="flex items-start gap-3 text-[15px]">
                  <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                  {t(`trust.items.${key}`)}
                </li>
              ),
            )}
          </ul>
        </Section>

        {/* FAQ */}
        <Section id="faq" title={t("faq.title")}>
          <div className="space-y-3">
            {(
              [
                "ai",
                "transfer",
                "unknown",
                "calendar",
                "number",
                "languages",
                "contract",
                "setup",
              ] as const
            ).map((key) => (
              <details key={key} className="glass group rounded-xl border border-border p-5">
                <summary className="cursor-pointer list-none font-display font-semibold marker:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {t(`faq.items.${key}.q`)}
                    <ArrowRight
                      className="size-4 shrink-0 transition-transform group-open:rotate-90"
                      aria-hidden
                    />
                  </span>
                </summary>
                <p className="mt-3 text-[15px] text-muted-foreground">
                  {t(`faq.items.${key}.a`, { name })}
                </p>
              </details>
            ))}
          </div>
        </Section>

        {/* Final call to action */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="glass aurora-border relative overflow-hidden rounded-2xl p-8 text-center sm:p-12">
            <Headset className="mx-auto size-10 text-primary" aria-hidden />
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight">
              {t("cta.title")}
            </h2>
            <p className="mt-2 text-muted-foreground">{t("cta.lead")}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {props.demos ? (
                <Link href="/try" className={buttonVariants({ size: "lg" })}>
                  {t("cta.try")}
                  <ArrowRight aria-hidden />
                </Link>
              ) : null}
              <Link
                href="/sign-up"
                className={buttonVariants({
                  variant: props.demos ? "secondary" : "primary",
                  size: "lg",
                })}
              >
                {t("cta.start")}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-3 sm:px-6">
          <div>
            <p className="font-display text-lg font-semibold">{name}</p>
            <p className="mt-1 text-muted-foreground">{t("footer.tagline")}</p>
          </div>
          <div>
            <p className="font-medium">{t("footer.product")}</p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li>
                <a href="#features" className="hover:text-foreground">
                  {t("nav.features")}
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-foreground">
                  {t("nav.pricing")}
                </a>
              </li>
              {props.demos ? (
                <li>
                  <Link href="/try" className="hover:text-foreground">
                    {t("cta.try")}
                  </Link>
                </li>
              ) : null}
            </ul>
          </div>
          <div>
            <p className="font-medium">{t("footer.account")}</p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li>
                <Link href="/sign-in" className="hover:text-foreground">
                  {t("nav.signIn")}
                </Link>
              </li>
              <li>
                <Link href="/sign-up" className="hover:text-foreground">
                  {t("nav.start")}
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <p className="pb-8 text-center text-xs text-muted-foreground">
          {t("footer.rights", { year: new Date().getFullYear(), name })}
        </p>
      </footer>
    </div>
  );
}
