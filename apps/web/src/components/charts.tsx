import { cn } from "@voicedesk/ui";

/**
 * Small, dependency-free SVG charts for the dashboard. Server-rendered, themed with CSS
 * variables (light/dark), scaled with viewBox, and every mark carries a native tooltip.
 */

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

const fill = (color: string) => ({ fill: color });
/** Stable SVG id for gradients (server components can't use useId). */
const gid = (...parts: string[]) =>
  `g-${parts
    .join("-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 60)}`;
const stroke = (color: string) => ({ stroke: color });

/**
 * Smooth line through points (monotone cubic, Fritsch–Carlson): curves never overshoot the
 * data, so counts don't dip below zero between points.
 */
function smoothPath(pts: ReadonlyArray<readonly [number, number]>): string {
  const n = pts.length;
  const f = (v: number) => v.toFixed(1);
  if (n < 3) return pts.map(([x, y], i) => `${i ? "L" : "M"}${f(x)},${f(y)}`).join(" ");
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    m.push((pts[i + 1]![1] - pts[i]![1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2);
  t.push(m[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i]! / m[i]!;
    const b = t[i + 1]! / m[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const k = 3 / Math.sqrt(h);
      t[i] = k * a * m[i]!;
      t[i + 1] = k * b * m[i]!;
    }
  }
  let d = `M${f(pts[0]![0])},${f(pts[0]![1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += ` C${f(x0 + h)},${f(y0 + t[i]! * h)} ${f(x1 - h)},${f(y1 - t[i + 1]! * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}

/** A tidy axis maximum: four equal whole-number steps (1, 2, 5 × 10ⁿ each) above the data. */
function niceMax(value: number): number {
  const raw = Math.max(1, value / 4);
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const step of [1, 2, 5, 10]) {
    const s = Math.max(1, step * power);
    if (s >= raw) return s * 4;
  }
  return 40 * power;
}

/** Stacked columns per period, one colour per series. */
export function StackedBars(props: {
  labels: string[];
  series: Series[];
  height?: number;
  /** Drawing width: smaller for small cards, so the text stays readable. */
  width?: number;
  emptyText: string;
}) {
  const height = props.height ?? 260;
  const width = props.width ?? 760;
  const pad = { top: 12, right: 8, bottom: 30, left: 34 };
  const n = props.labels.length;
  const totals = props.labels.map((_, i) =>
    props.series.reduce((s, x) => s + (x.values[i] ?? 0), 0),
  );
  const max = niceMax(Math.max(0, ...totals));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = innerW / n;
  const barW = Math.min(44, Math.max(6, slot * 0.62));
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const labelEvery = Math.ceil(n / (width < 500 ? 4 : 8));
  const empty = totals.every((t) => t === 0);
  return (
    <div className="relative overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={cn("h-auto w-full", width >= 600 && "min-w-[540px]")}
        role="img"
      >
        {(height < 200 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => (
          <g key={f}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(max * f)}
              y2={y(max * f)}
              className="stroke-border"
              strokeDasharray={f === 0 ? undefined : "3 4"}
            />
            <text
              x={pad.left - 6}
              y={y(max * f) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        <defs>
          {props.series.map((s) => (
            <linearGradient
              key={s.key}
              id={gid("bar", s.key, String(width))}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={1} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.55} />
            </linearGradient>
          ))}
        </defs>
        {props.labels.map((label, i) => {
          let acc = 0;
          const x = pad.left + slot * i + (slot - barW) / 2;
          return (
            <g key={label}>
              {props.series.map((s) => {
                const v = s.values[i] ?? 0;
                if (!v) return null;
                const top = y(acc + v);
                const h = y(acc) - top;
                acc += v;
                return (
                  <rect
                    key={s.key}
                    x={x}
                    y={top}
                    width={barW}
                    height={Math.max(h, 1)}
                    rx={Math.min(6, barW / 4)}
                    fill={`url(#${gid("bar", s.key, String(width))})`}
                    className="origin-bottom animate-bar-grow transition-opacity [transform-box:fill-box] hover:opacity-80"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <title>{`${label} · ${s.label}: ${v}`}</title>
                  </rect>
                );
              })}
              {totals[i] ? (
                <text
                  x={x + barW / 2}
                  y={y(totals[i]) - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {totals[i]}
                </text>
              ) : null}
              {(n - 1 - i) % labelEvery === 0 ? (
                <text
                  x={x + barW / 2}
                  y={height - 10}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {empty ? (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {props.emptyText}
        </p>
      ) : null}
    </div>
  );
}

/** Tiny trend line with a soft area, for KPI tiles. */
export function Sparkline(props: {
  values: Array<number | null>;
  color: string;
  className?: string;
}) {
  const w = 120;
  const h = 34;
  const values = props.values.map((v) => v ?? 0);
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 6)] as const);
  const line = smoothPath(pts);
  const id = gid("spark", props.color, values.join("."));
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-9 w-full overflow-visible", props.className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={props.color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={props.color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        className="animate-draw [stroke-dasharray:1]"
        style={{ ...stroke(props.color), filter: `drop-shadow(0 0 4px ${props.color})` }}
      />
    </svg>
  );
}

/** Share of a whole, with the total in the middle. */
export function Donut(props: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerLabel: string;
  emptyText: string;
}) {
  const total = props.segments.reduce((s, x) => s + x.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        viewBox="0 0 140 140"
        className="h-36 w-36 shrink-0 [filter:drop-shadow(0_0_10px_var(--color-glow))]"
        role="img"
      >
        <circle cx={70} cy={70} r={r} fill="none" strokeWidth={18} className="stroke-muted" />
        {total
          ? props.segments
              .filter((s) => s.value > 0)
              .map((s) => {
                const len = (s.value / total) * c;
                const el = (
                  <circle
                    key={s.label}
                    cx={70}
                    cy={70}
                    r={r}
                    fill="none"
                    strokeWidth={18}
                    strokeDasharray={`${len} ${c - len}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 70 70)"
                    style={stroke(s.color)}
                  >
                    <title>{`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}</title>
                  </circle>
                );
                offset += len;
                return el;
              })
          : null}
        <text
          x={70}
          y={68}
          textAnchor="middle"
          className="fill-foreground text-[22px] font-semibold"
        >
          {total}
        </text>
        <text x={70} y={86} textAnchor="middle" className="fill-muted-foreground text-[10px]">
          {props.centerLabel}
        </text>
      </svg>
      <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
        {total === 0 ? <li className="text-muted-foreground">{props.emptyText}</li> : null}
        {props.segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="flex-1">{s.label}</span>
            <span className="tabular-nums">{s.value}</span>
            <span className="w-10 text-end text-xs text-muted-foreground tabular-nums">
              {total ? `${Math.round((s.value / total) * 100)}%` : "–"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Weekday × hour grid: darker means more customers got in touch. */
export function Heatmap(props: { grid: number[][]; days: string[]; emptyText: string }) {
  const max = Math.max(0, ...props.grid.flat());
  const cell = 26;
  const gap = 3;
  const left = 34;
  const top = 16;
  const width = left + 24 * (cell + gap);
  const height = top + 7 * (cell + gap);
  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[560px]" role="img">
        {Array.from({ length: 24 }, (_, hr) =>
          hr % 3 === 0 ? (
            <text
              key={hr}
              x={left + hr * (cell + gap) + cell / 2}
              y={10}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px]"
            >
              {String(hr).padStart(2, "0")}
            </text>
          ) : null,
        )}
        {props.grid.map((row, d) => (
          <g key={d}>
            <text
              x={left - 6}
              y={top + d * (cell + gap) + cell / 2 + 3}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {props.days[d]}
            </text>
            {row.map((v, hr) => (
              <rect
                key={hr}
                x={left + hr * (cell + gap)}
                y={top + d * (cell + gap)}
                width={cell}
                height={cell}
                rx={4}
                className={v ? undefined : "fill-muted"}
                style={
                  v
                    ? { fill: "var(--color-primary)", opacity: 0.15 + 0.85 * (v / (max || 1)) }
                    : undefined
                }
              >
                <title>{`${props.days[d]} ${String(hr).padStart(2, "0")}:00 · ${v}`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      {max === 0 ? (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {props.emptyText}
        </p>
      ) : null}
    </div>
  );
}

/** Horizontal bars, largest first. */
export function BarList(props: {
  items: Array<{ label: string; value: number; color?: string }>;
  emptyText: string;
}) {
  const max = Math.max(1, ...props.items.map((i) => i.value));
  if (props.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{props.emptyText}</p>;
  }
  return (
    <ul className="space-y-2 text-sm">
      {props.items.map((item) => (
        <li key={item.label}>
          <div className="flex justify-between gap-2">
            <span>{item.label}</span>
            <span className="tabular-nums text-muted-foreground">{item.value}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                background: item.color ?? "var(--color-primary)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Steps that narrow: conversations → something recorded → bookings. */
export function Funnel(props: { steps: Array<{ label: string; value: number }> }) {
  const first = props.steps[0]?.value || 1;
  return (
    <div className="space-y-2">
      {props.steps.map((step, i) => {
        const share = Math.round((step.value / first) * 100);
        return (
          <div key={step.label}>
            <div className="flex justify-between text-sm">
              <span>{step.label}</span>
              <span className="tabular-nums">
                {step.value}
                {i > 0 ? (
                  <span className="ms-1 text-xs text-muted-foreground">({share}%)</span>
                ) : null}
              </span>
            </div>
            <div className="mt-1 flex justify-center">
              <div
                className="h-7 rounded-md"
                style={{
                  width: `${Math.max(6, share)}%`,
                  background: "var(--color-primary)",
                  opacity: 1 - i * 0.25,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Trend line over the periods (gaps where there's no data), with an area underneath. */
export function LineChart(props: {
  labels: string[];
  values: Array<number | null>;
  color: string;
  unit?: string;
  max?: number;
  /** Show values divided by this (e.g. 1000 to show milliseconds as seconds). */
  divide?: number;
  decimals?: number;
  emptyText: string;
}) {
  const show = (v: number) => (v / (props.divide ?? 1)).toFixed(props.decimals ?? 0);
  const width = 360;
  const height = 150;
  const pad = { top: 14, right: 10, bottom: 24, left: 34 };
  const present = props.values.filter((v): v is number => v !== null);
  const max = props.max ?? niceMax(Math.max(0, ...present));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const n = props.labels.length;
  const x = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
  const y = (v: number) => pad.top + innerH - (v / (max || 1)) * innerH;
  const points = props.values
    .map((v, i) => (v === null ? null : ([x(i), y(v), v, props.labels[i]!] as const)))
    .filter((p): p is readonly [number, number, number, string] => p !== null);
  const line = smoothPath(points.map(([px, py]) => [px, py] as const));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(max * f)}
              y2={y(max * f)}
              className="stroke-border"
              strokeDasharray={f ? "3 4" : undefined}
            />
            <text
              x={pad.left - 6}
              y={y(max * f) + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[10px]"
            >
              {show(max * f)}
              {props.unit}
            </text>
          </g>
        ))}
        <defs>
          <linearGradient
            id={gid("line", props.color, props.unit ?? "")}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={props.color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={props.color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {points.length > 1 ? (
          <path
            d={`${line} L${points.at(-1)![0]},${y(0)} L${points[0]![0]},${y(0)} Z`}
            fill={`url(#${gid("line", props.color, props.unit ?? "")})`}
          />
        ) : null}
        {points.length ? (
          <path
            d={line}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={1}
            className="animate-draw [stroke-dasharray:1]"
            style={{ ...stroke(props.color), filter: `drop-shadow(0 0 6px ${props.color})` }}
          />
        ) : null}
        {points.map(([px, py, v, label], i) => (
          <g key={label}>
            {i === points.length - 1 ? (
              <circle
                cx={px}
                cy={py}
                r={8}
                className="animate-glow-pulse"
                style={{ fill: props.color, opacity: 0.25 }}
              />
            ) : null}
            <circle cx={px} cy={py} r={3.5} style={fill(props.color)}>
              <title>{`${label}: ${show(v)}${props.unit ?? ""}`}</title>
            </circle>
          </g>
        ))}
        {[0, n - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={height - 6}
            textAnchor={i === 0 ? "start" : "end"}
            className="fill-muted-foreground text-[10px]"
          >
            {props.labels[i]}
          </text>
        ))}
      </svg>
      {points.length === 0 ? (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {props.emptyText}
        </p>
      ) : null}
    </div>
  );
}

/** One bar split by share (e.g. sentiment). */
export function ShareBar(props: {
  parts: Array<{ label: string; value: number; color: string }>;
  emptyText: string;
}) {
  const total = props.parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="text-sm text-muted-foreground">{props.emptyText}</p>;
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full bg-muted">
        {props.parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.label}
              title={`${p.label}: ${p.value}`}
              style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            />
          ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {props.parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.label} {Math.round((p.value / total) * 100)}%
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The hero chart: a smooth area with an aurora-gradient trail that draws in, a glowing latest
 * point and a tooltip per period.
 */
export function AreaChart(props: {
  labels: string[];
  values: number[];
  emptyText: string;
  height?: number;
  /** Tooltip suffix, e.g. " conversations". */
  unit?: string;
  /** Drawing width: smaller for phones, so the axis text stays readable. */
  width?: number;
  className?: string;
}) {
  const width = props.width ?? 760;
  const height = props.height ?? 220;
  const pad = { top: 16, right: 12, bottom: 28, left: 34 };
  const n = props.values.length;
  const max = niceMax(Math.max(0, ...props.values));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const pts = props.values.map((v, i) => [x(i), y(v)] as const);
  const line = smoothPath(pts);
  const total = props.values.reduce((a, b) => a + b, 0);
  const id = gid("area", String(width), String(n), props.values.join("."));
  const every = Math.max(1, Math.ceil(n / (width < 500 ? 4 : 7)));
  return (
    <div className={cn("relative", props.className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full overflow-visible" role="img">
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.32} />
            <stop offset="60%" stopColor="var(--color-secondary)" stopOpacity={0.08} />
            <stop offset="100%" stopColor="var(--color-secondary)" stopOpacity={0} />
          </linearGradient>
          <linearGradient
            id={`${id}-line`}
            gradientUnits="userSpaceOnUse"
            x1={pad.left}
            x2={width - pad.right}
            y1="0"
            y2="0"
          >
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="55%" stopColor="var(--color-secondary)" />
            <stop offset="100%" stopColor="var(--color-accent)" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(max * f)}
              y2={y(max * f)}
              className="stroke-border"
              strokeDasharray={f ? "2 6" : undefined}
            />
            {f === 0 || f === 0.5 || f === 1 ? (
              <text
                x={pad.left - 8}
                y={y(max * f) + 4}
                textAnchor="end"
                className="fill-muted-foreground text-[11px]"
              >
                {Math.round(max * f)}
              </text>
            ) : null}
          </g>
        ))}
        {n > 1 ? (
          <path
            d={`${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`}
            fill={`url(#${id}-fill)`}
            className="animate-rise"
          />
        ) : null}
        {n ? (
          <path
            d={line}
            fill="none"
            stroke={`url(#${id}-line)`}
            strokeWidth={3}
            strokeLinecap="round"
            pathLength={1}
            className="animate-draw [stroke-dasharray:1]"
            style={{ filter: "drop-shadow(0 0 8px var(--color-glow))" }}
          />
        ) : null}
        {n ? (
          <g>
            <circle
              cx={x(n - 1)}
              cy={y(props.values[n - 1]!)}
              r={10}
              className="animate-glow-pulse"
              style={{ fill: "var(--color-accent)", opacity: 0.25 }}
            />
            <circle
              cx={x(n - 1)}
              cy={y(props.values[n - 1]!)}
              r={4.5}
              className="stroke-background"
              strokeWidth={2}
              style={{ fill: "var(--color-accent)" }}
            />
          </g>
        ) : null}
        {props.values.map((v, i) => (
          <g key={props.labels[i] ?? i} className="group">
            <rect
              x={x(i) - innerW / Math.max(1, n - 1) / 2}
              y={pad.top}
              width={innerW / Math.max(1, n - 1)}
              height={innerH}
              className="fill-transparent"
            >
              <title>{`${props.labels[i]}: ${v}${props.unit ?? ""}`}</title>
            </rect>
            <line
              x1={x(i)}
              x2={x(i)}
              y1={pad.top}
              y2={y(0)}
              className="stroke-primary opacity-0 transition-opacity group-hover:opacity-60"
              strokeDasharray="3 4"
            />
            <circle
              cx={x(i)}
              cy={y(v)}
              r={4}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              style={{ fill: "var(--color-primary)" }}
            />
            {(n - 1 - i) % every === 0 ? (
              <text
                x={x(i)}
                y={height - 6}
                textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"}
                className="fill-muted-foreground text-[11px]"
              >
                {props.labels[i]}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      {total === 0 ? (
        <p className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {props.emptyText}
        </p>
      ) : null}
    </div>
  );
}

/** A ring that fills to a percentage with an aurora gradient (e.g. handled by the assistant). */
export function RadialGauge(props: { value: number | null; label: string; className?: string }) {
  const size = 168;
  const r = 68;
  const v = props.value === null ? 0 : Math.max(0, Math.min(100, props.value));
  const id = gid("gauge", String(v));
  return (
    <div className={cn("relative mx-auto aspect-square w-full max-w-[188px]", props.className)}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="size-full -rotate-90"
        role="img"
        aria-label={`${props.label}: ${props.value === null ? "–" : `${v}%`}`}
      >
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={size} y2={size}>
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="55%" stopColor="var(--color-secondary)" />
            <stop offset="100%" stopColor="var(--color-accent)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={12}
          className="stroke-muted"
        />
        {Array.from({ length: 40 }, (_, i) => {
          const a = (i / 40) * Math.PI * 2;
          return (
            <line
              key={i}
              x1={size / 2 + Math.cos(a) * (r - 14)}
              y1={size / 2 + Math.sin(a) * (r - 14)}
              x2={size / 2 + Math.cos(a) * (r - 11)}
              y2={size / 2 + Math.sin(a) * (r - 11)}
              className="stroke-border"
              strokeWidth={1.5}
            />
          );
        })}
        {v > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={12}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${v} 100`}
            className="animate-gauge"
            style={{
              ["--gauge-from" as string]: v,
              filter: "drop-shadow(0 0 10px var(--color-glow))",
            }}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular font-display text-[40px] leading-none font-semibold tracking-tight">
          {props.value === null ? "–" : v}
          {props.value === null ? null : <span className="text-xl text-muted-foreground">%</span>}
        </span>
      </div>
    </div>
  );
}
