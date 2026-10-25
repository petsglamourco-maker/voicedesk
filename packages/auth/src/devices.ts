/** "Chrome on Windows"-style label for a session's user agent (no external parser). */
export function describeDevice(userAgent: string | null | undefined): {
  browser: string | null;
  os: string | null;
} {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  return { browser, os };
}

/**
 * Identifies "the same kind of device" for new-device alerts: browser + OS family only, so
 * browser updates don't trigger alerts and no raw user agent is stored.
 */
export function deviceKey(userAgent: string | null | undefined): string {
  const { browser, os } = describeDevice(userAgent);
  return `${browser ?? "unknown"}|${os ?? "unknown"}`;
}
