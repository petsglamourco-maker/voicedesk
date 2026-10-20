"use client";

// Calm, spring-based motion (Motion / Framer Motion). Everything respects reduced motion.
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
 * A key number: label, count-up value, optional trend and chart. Plain props only, so server
 * pages can render it. `trend.delta` is a percentage change; `goodWhen` says which direction
 * is good (e.g. "down" for response time). The arrow and sign carry the meaning, not colour.
 */
export function KpiCard(props: {
  label: ReactNode;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  trend?: { delta: number; label?: ReactNode; goodWhen?: "up" | "down" };
  icon?: LucideIcon;
  chart?: ReactNode;
  hero?: boolean;
  className?: string;
}) {
  const decimals = props.decimals ?? 0;
  const format = (v: number) =>
    `${props.prefix ?? ""}${v.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}${props.suffix ?? ""}`;
  const Icon = props.icon;
  const trend = props.trend;
  const up = trend ? trend.delta >= 0 : true;
  const good = trend ? (trend.goodWhen === "down" ? !up : up) || trend.delta === 0 : true;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <div
      className={cn(
        "glass relative flex flex-col gap-3 overflow-hidden rounded-xl p-5",
        props.hero && "border-primary/30 p-6 shadow-[0_0_40px_-8px_var(--color-glow)]",
        props.className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {Icon ? (
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
        <span className="truncate">{props.label}</span>
      </div>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <NumberTicker
          value={props.value}
          format={format}
          className={cn(
            "font-display leading-none font-semibold tracking-tight",
            props.hero ? "text-aurora text-[48px] sm:text-[56px]" : "text-[32px] sm:text-[40px]",
          )}
        />
        {trend ? (
          <span
            className={cn(
              "mb-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular",
              good ? "bg-success/12 text-success" : "bg-danger/12 text-danger",
            )}
          >
            <Arrow className="size-3.5" aria-hidden />
            {`${up ? "+" : "−"}${Math.abs(Math.round(trend.delta))}%`}
            {trend.label ? (
              <span className="ms-1 font-medium text-muted-foreground">{trend.label}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      {props.chart ? <div className="-mx-1 mt-auto">{props.chart}</div> : null}
    </div>
  );
}
