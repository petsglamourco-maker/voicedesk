"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile bot check (ADR 0022). Renders only when the server has it switched on
 * (a site key), and usually stays invisible: it appears only if Cloudflare needs the visitor to
 * tick a box. Reports each new token; tokens last 5 minutes and work once.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id?: string) => void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(s);
  });
  return loading;
}

export function Turnstile(props: {
  siteKey: string;
  onToken: (token: string | null) => void;
  /** Bump to get a fresh token after one was used. */
  resetKey?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const { siteKey, onToken } = props;

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile || widget.current) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      cancelled = true;
    };
  }, [siteKey, onToken]);

  useEffect(() => {
    if (props.resetKey && widget.current) window.turnstile?.reset(widget.current);
  }, [props.resetKey]);

  return <div ref={box} />;
}
