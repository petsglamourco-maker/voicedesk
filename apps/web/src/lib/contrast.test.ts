// WCAG 2.2 AA contrast over the design tokens in globals.css, in both modes. Text needs 4.5:1;
// UI parts and chart marks need 3:1. Tinted and glass surfaces are blended before measuring.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

type Rgba = [number, number, number, number];

function block(selectorStart: string): Record<string, string> {
  const at = css.indexOf(selectorStart);
  if (at < 0) throw new Error(`missing ${selectorStart}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (rgb) return [+rgb[1]!, +rgb[2]!, +rgb[3]!, rgb[4] ? +rgb[4] : 1];
  throw new Error(`unparsed colour ${value}`);
}

/** `top` at `alpha` over an opaque `base`. */
function over(top: Rgba, base: Rgba, alpha = top[3]): Rgba {
  return [0, 1, 2].map((i) => top[i]! * alpha + base[i]! * (1 - alpha)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const dark = block("@theme {");
const light = block('[data-theme="light"] {');
const system = block('[data-theme="system"] {');

const TONES = ["primary", "secondary", "accent", "info", "success", "warning", "danger"];
const CHANNELS = ["voice", "outbound", "web", "whatsapp", "email", "form"];

function checks(t: Record<string, string>) {
  const c = (name: string) => parse(t[name]!);
  const bg = c("background");
  const glass = over(c("glass"), bg);
  const grounds: Array<[string, Rgba]> = [
    ["background", bg],
    ["surface", c("surface")],
    ["glass", glass],
  ];
  const list: Array<[string, Rgba, Rgba, number]> = [];
  for (const [g, ground] of grounds) {
    list.push([`foreground on ${g}`, c("foreground"), ground, 4.5]);
    list.push([`muted-foreground on ${g}`, c("muted-foreground"), ground, 4.5]);
    for (const tone of TONES) list.push([`${tone} text on ${g}`, c(tone), ground, 4.5]);
    list.push([`input border on ${g}`, c("input"), ground, 3]);
    list.push([`focus ring on ${g}`, c("ring"), ground, 3]);
    for (const ch of CHANNELS) list.push([`channel ${ch} on ${g}`, c(`ch-${ch}`), ground, 3]);
  }
  list.push(["muted-foreground on muted", c("muted-foreground"), c("muted"), 4.5]);
  list.push(["foreground on muted", c("foreground"), c("muted"), 4.5]);
  for (const tone of ["primary", "secondary", "accent", "danger"])
    list.push([`${tone}-foreground on ${tone}`, c(`${tone}-foreground`), c(tone), 4.5]);
  // Badges and alerts: tone text on a 12% tint of itself over the glass card.
  for (const tone of TONES) {
    const tint = over(c(tone), glass, 0.12);
    list.push([`${tone} badge text on its tint`, c(tone), tint, 4.5]);
    list.push([
      `foreground on ${tone} alert tint`,
      c("foreground"),
      over(c(tone), glass, 0.1),
      4.5,
    ]);
  }
  return list;
}

describe.each([
  ["dark", dark],
  ["light", light],
])("contrast (%s)", (_mode, tokens) => {
  it.each(checks(tokens).map(([name, a, b, min]) => ({ name, a, b, min })))(
    "$name ≥ $min",
    ({ a, b, min }) => {
      expect(Number(ratio(a, b).toFixed(2))).toBeGreaterThanOrEqual(min);
    },
  );
});

describe("theme blocks", () => {
  it("system (light preference) matches the light theme", () => {
    expect(system).toEqual(light);
  });
  it("light defines every dark colour token", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });
});
