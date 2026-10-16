/** Only allow same-site relative paths as post-auth redirects (prevents open redirects). */
export function safeRedirect(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  return value;
}
