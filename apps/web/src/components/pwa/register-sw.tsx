"use client";

import { useEffect } from "react";

/**
 * Registers the service worker (public/sw.js, ADR 0024) on secure pages: https, or
 * localhost on this PC. It only caches the offline page and shows push notifications.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => undefined);
  }, []);
  return null;
}
