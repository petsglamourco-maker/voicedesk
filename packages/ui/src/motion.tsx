"use client";

// Calm, spring-based motion (Motion / Framer Motion). Everything respects reduced motion.
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "./cn";

/** Counts up to `value` when it comes into view (instantly with reduced motion). */
export function NumberTicker(props: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const format = props.format ?? ((v: number) => String(Math.round(v)));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, props.value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setShown,
    });
    return () => controls.stop();
  }, [inView, props.value, reduce]);
  return (
    <span ref={ref} className={cn("tabular", props.className)}>
      {format(reduce ? props.value : shown)}
    </span>
  );
}

/** Fades and lifts content in on first view; `index` staggers siblings. */
export function Reveal(props: { children: ReactNode; index?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={props.className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ type: "spring", stiffness: 260, damping: 30, delay: (props.index ?? 0) * 0.05 }}
    >
      {props.children}
    </motion.div>
  );
}

const BURST_COLORS = [
  "var(--color-primary)",
  "var(--color-secondary)",
  "var(--color-accent)",
  "var(--color-success)",
  "var(--color-warning)",
];

/** A short burst of light for key wins (booking made, draft approved…). */
export function Celebrate(props: { show: boolean; className?: string }) {
  const reduce = useReducedMotion();
  if (!props.show || reduce) return null;
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-visible", props.className)}
    >
      {Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2;
        const distance = 46 + (i % 3) * 14;
        return (
          <motion.span
            key={i}
            className="absolute top-1/2 left-1/2 size-1.5 rounded-full"
            style={{ background: BURST_COLORS[i % BURST_COLORS.length] }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(angle) * distance,
              y: Math.sin(angle) * distance,
              opacity: 0,
              scale: 0.4,
            }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
    </span>
  );
}

/**
 * A key number: label, count-up value, optional trend, hint and chart. Serializable props only
 * (pass the icon as an element, e.g. `icon={<Users />}`), so server pages can render it.
 * `trend.delta` is a percentage change; `goodWhen` says which direction is good (e.g. "down"
 * for response time). The arrow and sign carry the meaning, not just colour.
 */
export function KpiCard(props: {
  label: ReactNode;
  value: number | null;
  /** Shown when there is no value yet. */
  placeholder?: string;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  trend?: { delta: number; label?: ReactNode; goodWhen?: "up" | "down" } | null;
  hint?: ReactNode;
  icon?: ReactNode;
  /** Accent for the icon chip, as a CSS colour (e.g. "var(--color-ch-voice)"). */
  color?: string;
  chart?: ReactNode;
  hero?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const decimals = props.decimals ?? 0;
  const format = (v: number) =>
    `${props.prefix ?? ""}${v.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${props.suffix ?? ""}`;
  const trend = props.trend;
  const up = trend ? trend.delta >= 0 : true;
  const good = trend ? (trend.goodWhen === "down" ? !up : up) || trend.delta === 0 : true;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  const color = props.color ?? "var(--color-primary)";
  return (
    <div
      className={cn(
        "glass group relative flex flex-col gap-2 overflow-hidden rounded-xl p-5 transition-[border-color,box-shadow,transform] duration-300 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--kpi)_40%,transparent)] hover:shadow-[0_12px_40px_-16px_var(--kpi)]",
        props.hero && "border-primary/30 p-6 shadow-[0_0_40px_-8px_var(--color-glow)]",
        props.className,
      )}
      style={{ ...props.style, ["--kpi" as string]: color }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -end-12 size-32 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-40"
        style={{ background: color }}
      />
      <div className="flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
        {props.icon ? (
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4"
            style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
            aria-hidden
          >
            {props.icon}
          </span>
        ) : null}
        <span className="leading-tight">{props.label}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
        {props.value === null ? (
          <span
            className={cn(
              "font-display leading-none font-semibold tracking-tight text-muted-foreground",
              props.hero ? "text-[48px] sm:text-[56px]" : "text-[32px] sm:text-[36px]",
            )}
          >
            {props.placeholder ?? "–"}
          </span>
        ) : (
          <NumberTicker
            value={props.value}
            format={format}
            className={cn(
              "font-display leading-none font-semibold tracking-tight",
              props.hero ? "text-aurora text-[48px] sm:text-[56px]" : "text-[32px] sm:text-[36px]",
            )}
          />
        )}
        {trend ? (
          <span
            className={cn(
              "tabular mb-0.5 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
              good ? "bg-success/12 text-success" : "bg-danger/12 text-danger",
            )}
          >
            <Arrow className="size-3.5" aria-hidden />
            {`${up ? "+" : "−"}${Math.abs(Math.round(trend.delta))}%`}
            {trend.label ? <span className="sr-only"> {trend.label}</span> : null}
          </span>
        ) : null}
      </div>
      {props.hint ? <p className="text-xs text-muted-foreground">{props.hint}</p> : null}
      {props.chart ? <div className="-mx-1 mt-auto pt-2">{props.chart}</div> : null}
    </div>
  );
}
