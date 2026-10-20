"use client";

// Calm, spring-based motion (Motion / Framer Motion). Everything respects reduced motion.
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
