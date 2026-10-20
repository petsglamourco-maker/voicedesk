/** Light/dark preference (presentation only). Dark is the default and showcase. */
export const THEME_COOKIE = "vd-theme";
export const THEMES = ["dark", "light", "system"] as const;
export type Theme = (typeof THEMES)[number];

export function toTheme(value: string | undefined): Theme {
  return (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : "dark";
}
