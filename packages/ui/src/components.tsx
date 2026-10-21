// "Aurora Glow" primitives (DESIGN.md): shadcn/ui-style, Tailwind v4 tokens defined by the
// host app. Names and props of the original primitives are unchanged; variants were added.
import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const buttonVariants = cva(
  `relative inline-flex select-none items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-[background-color,box-shadow,transform,color] duration-200 ease-[var(--ease-spring)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55 [&_svg]:size-4 [&_svg]:shrink-0 ${focusRing}`,
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-[0_0_20px_0_var(--color-glow)] hover:shadow-[0_0_28px_2px_var(--color-glow)] hover:brightness-110",
        secondary:
          "glass text-foreground hover:border-input hover:bg-[color-mix(in_srgb,var(--color-surface-raised)_80%,transparent)]",
        ghost: "text-foreground hover:bg-muted",
        link: "h-auto px-0 text-secondary underline-offset-4 hover:underline",
        danger:
          "bg-danger text-danger-foreground hover:brightness-110 hover:shadow-[0_0_22px_0_color-mix(in_srgb,var(--color-danger)_35%,transparent)]",
        accent:
          "bg-accent text-accent-foreground shadow-[0_0_20px_0_color-mix(in_srgb,var(--color-accent)_30%,transparent)] hover:brightness-110",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "size-10 p-0",
        "icon-sm": "size-8 p-0",
      },
      shape: {
        default: "",
        pill: "rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md", shape: "default" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  shape,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, shape }), className)}
      {...props}
    />
  );
}

const fieldBase = `block w-full rounded-md border border-input/60 bg-[color-mix(in_srgb,var(--color-surface)_65%,transparent)] px-3 text-[15px] text-foreground placeholder:text-muted-foreground transition-[border-color,box-shadow] duration-200 hover:border-input focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_22%,transparent),0_0_20px_0_var(--color-glow)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-danger)_25%,transparent)]`;

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(fieldBase, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        fieldBase,
        "h-10 appearance-none bg-[length:16px] bg-[position:right_0.65rem_center] bg-no-repeat pe-9 [background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")] rtl:bg-[position:left_0.65rem_center]",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-semibold", className)} {...props} />;
}

/** Label + control + hint + inline error, wired for screen readers. */
export function Field(props: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", props.className)}>
      <Label htmlFor={props.id} className="mb-0">
        {props.label}
      </Label>
      {props.children}
      {props.error ? (
        <p id={`${props.id}-error`} className="flex items-center gap-1.5 text-xs text-danger">
          <XCircle className="size-3.5" aria-hidden />
          {props.error}
        </p>
      ) : props.hint ? (
        <p id={`${props.id}-hint`} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

const cardVariants = cva("rounded-xl p-6", {
  variants: {
    variant: {
      glass: "glass",
      solid: "border border-border bg-surface",
      hero: "glass relative overflow-hidden border-primary/30 shadow-[0_0_40px_-8px_var(--color-glow)]",
      ghost: "border border-dashed border-border",
    },
  },
  defaultVariants: { variant: "glass" },
});

export function Card({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn("font-display text-lg font-semibold tracking-tight", className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />;
}

/** Page heading: Sora title, optional description and actions. */
export function PageHeader(props: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end gap-4", props.className)}>
      <div className="min-w-0 flex-1">
        {props.eyebrow ? (
          <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            {props.eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-[32px] leading-tight font-semibold tracking-tight sm:text-[36px]">
          {props.title}
        </h1>
        {props.description ? (
          <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
      {props.actions ? (
        <div className="flex flex-wrap items-center gap-2">{props.actions}</div>
      ) : null}
    </div>
  );
}

const alertVariants = cva("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", {
  variants: {
    tone: {
      info: "border-info/30 bg-info/10 text-foreground [&>svg]:text-info",
      error: "border-danger/40 bg-danger/10 text-foreground [&>svg]:text-danger",
      success: "border-success/40 bg-success/10 text-foreground [&>svg]:text-success",
      warning: "border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning",
    },
  },
  defaultVariants: { tone: "info" },
});

const ALERT_ICON: Record<"info" | "error" | "success" | "warning", LucideIcon> = {
  info: Info,
  error: XCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
};

export function Alert({
  className,
  tone,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  const Icon = ALERT_ICON[tone ?? "info"];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-foreground",
        primary: "border-primary/35 bg-primary/12 text-primary",
        secondary: "border-secondary/35 bg-secondary/12 text-secondary",
        accent: "border-accent/35 bg-accent/12 text-accent",
        success: "border-success/35 bg-success/12 text-success",
        warning: "border-warning/35 bg-warning/12 text-warning",
        danger: "border-danger/35 bg-danger/12 text-danger",
        info: "border-info/35 bg-info/12 text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export type StatusTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

/** Status with its own colour and icon (colour is never the only signal). */
export function StatusPill(props: {
  tone: StatusTone;
  icon?: LucideIcon;
  label: ReactNode;
  live?: boolean;
  className?: string;
}) {
  const Icon = props.icon ?? CircleDot;
  return (
    <Badge tone={props.tone} className={props.className}>
      <Icon className={cn(props.live && "animate-glow-pulse")} aria-hidden />
      {props.label}
    </Badge>
  );
}

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-[11px] font-semibold text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Content-shaped loading placeholder with a soft shimmer. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative overflow-hidden rounded-md bg-muted before:absolute before:inset-0 before:animate-shimmer before:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--color-foreground)_7%,transparent),transparent)]",
        className,
      )}
      {...props}
    />
  );
}

export function Progress(props: {
  value: number;
  max?: number;
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (props.value / (props.max ?? 100)) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={props.label}
      className={cn("h-2 overflow-hidden rounded-full bg-muted", props.className)}
    >
      <div
        className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary))] shadow-[0_0_12px_0_var(--color-glow)] transition-[width] duration-500 ease-[var(--ease-spring)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const AVATAR_TONES = [
  "bg-primary/18 text-primary",
  "bg-secondary/18 text-secondary",
  "bg-accent/18 text-accent",
  "bg-info/18 text-info",
  "bg-success/18 text-success",
  "bg-warning/18 text-warning",
];

/** Initials avatar; each person gets a stable colour from their name. */
export function Avatar(props: { name: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const initials =
    props.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?";
  let hash = 0;
  for (const ch of props.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-display font-semibold",
        props.size === "sm"
          ? "size-7 text-[11px]"
          : props.size === "lg"
            ? "size-12 text-base"
            : "size-9 text-xs",
        AVATAR_TONES[hash % AVATAR_TONES.length],
        props.className,
      )}
    >
      {initials}
    </span>
  );
}

/** Empty list or page: an icon "illustration", a sentence, and one clear next action. */
export function EmptyState(props: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = props.icon;
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", props.className)}>
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,var(--color-glow),transparent_70%)] blur-xl" />
        <div className="glass relative flex size-14 items-center justify-center rounded-2xl">
          <Icon className="size-6 text-primary" aria-hidden />
        </div>
      </div>
      <p className="font-display text-base font-semibold">{props.title}</p>
      {props.description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{props.description}</p>
      ) : null}
      {props.action ? <div className="mt-5">{props.action}</div> : null}
    </div>
  );
}

/**
 * The signature page header: a glass banner with the turning aurora edge, corner light, star
 * dots and a glowing icon orb. One per screen. `children` is an optional row of HeroStat chips.
 */
export function PageHero(props: {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Extra attributes for the h1 (e.g. dir="auto" for user-provided names). */
  titleProps?: HTMLAttributes<HTMLHeadingElement>;
}) {
  return (
    <header
      className={cn(
        "glass aurora-border relative animate-rise overflow-hidden rounded-xl px-5 py-6 sm:px-7",
        props.className,
      )}
    >
      <div aria-hidden className="spotlight pointer-events-none absolute inset-0" />
      <div aria-hidden className="dot-grid pointer-events-none absolute inset-0" />
      <div className="relative flex flex-wrap items-center gap-x-5 gap-y-4">
        {props.icon ? (
          <span aria-hidden className="relative flex size-14 shrink-0 items-center justify-center">
            <span className="absolute inset-0 animate-glow-pulse rounded-2xl bg-[linear-gradient(135deg,var(--color-primary),var(--color-secondary)_60%,var(--color-accent))] opacity-60 blur-lg" />
            <span className="relative flex size-14 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,var(--color-primary),var(--color-secondary)_60%,var(--color-accent))] text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.35)] [&_svg]:size-6">
              {props.icon}
            </span>
          </span>
        ) : null}
        <div className="min-w-0 flex-1 basis-60">
          {props.eyebrow ? (
            <p className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              {props.eyebrow}
            </p>
          ) : null}
          <h1
            {...props.titleProps}
            className={cn(
              "font-display text-[28px] leading-tight font-semibold tracking-tight sm:text-[34px]",
              props.titleProps?.className,
            )}
          >
            {props.title}
          </h1>
          {props.description ? (
            <p className="mt-1.5 max-w-2xl text-[15px] text-muted-foreground">
              {props.description}
            </p>
          ) : null}
        </div>
        {props.actions ? (
          <div className="flex flex-wrap items-center gap-2">{props.actions}</div>
        ) : null}
      </div>
      {props.children ? (
        <div className="relative mt-5 flex flex-wrap gap-2">{props.children}</div>
      ) : null}
    </header>
  );
}

/** A small number chip for a PageHero (e.g. "12 calls", "1.4 s median"). */
export function HeroStat(props: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  color?: string;
}) {
  const color = props.color ?? "var(--color-primary)";
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-[color-mix(in_srgb,var(--color-surface)_55%,transparent)] px-3 py-2">
      {props.icon ? (
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5"
          style={{
            color,
            background: `color-mix(in srgb, ${color} 16%, transparent)`,
            boxShadow: `0 0 14px -4px ${color}`,
          }}
        >
          {props.icon}
        </span>
      ) : null}
      <span>
        <span className="block text-[11px] text-muted-foreground">{props.label}</span>
        <span className="tabular font-display text-base leading-tight font-semibold">
          {props.value}
        </span>
      </span>
    </div>
  );
}

/** Card header: tinted icon chip, title and hint, optional actions on the end. */
export function CardHead(props: {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  color?: string;
  aside?: ReactNode;
  className?: string;
  /** Heading level; defaults to h2. */
  as?: "h2" | "h3";
}) {
  const color = props.color ?? "var(--color-primary)";
  const Heading = props.as ?? "h2";
  return (
    <div className={cn("flex items-start gap-3", props.className)}>
      {props.icon ? (
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]"
          style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
        >
          {props.icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <Heading className="font-display text-base font-semibold tracking-tight">
          {props.title}
        </Heading>
        {props.hint ? <p className="mt-0.5 text-sm text-muted-foreground">{props.hint}</p> : null}
      </div>
      {props.aside ? <div className="flex shrink-0 items-center gap-2">{props.aside}</div> : null}
    </div>
  );
}

/** Slow-drifting aurora behind the app (static when reduced motion is on). */
export function AuroraBackground(props: { className?: string; intensity?: "soft" | "vivid" }) {
  const opacity = props.intensity === "vivid" ? "opacity-[0.45]" : "opacity-[0.3]";
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", props.className)}
    >
      <div
        className={cn(
          "absolute -top-[20%] -left-[10%] h-[60vh] w-[55vw] animate-aurora rounded-full bg-aurora-1 blur-[120px]",
          opacity,
        )}
      />
      <div
        className={cn(
          "absolute top-[10%] -right-[15%] h-[55vh] w-[50vw] animate-aurora rounded-full bg-aurora-2 blur-[120px] [animation-delay:-11s]",
          opacity,
        )}
      />
      <div
        className={cn(
          "absolute -bottom-[25%] left-[25%] h-[55vh] w-[50vw] animate-aurora rounded-full bg-aurora-3 blur-[130px] [animation-delay:-21s]",
          opacity,
        )}
      />
      <div className="grain absolute inset-0" />
    </div>
  );
}
