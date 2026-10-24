"use client";

import { confirmPassword, REAUTH_REQUIRED } from "./reauth";

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Browser-side JSON call to our API (same origin; cookies sent automatically). Sensitive
 * actions that need the password confirmed ask for it and are retried once.
 */
export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;
    if (
      res.status === 403 &&
      body?.error === REAUTH_REQUIRED &&
      !retried &&
      (await confirmPassword())
    )
      return api<T>(path, init, true);
    throw new ClientApiError(res.status, body?.message ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
