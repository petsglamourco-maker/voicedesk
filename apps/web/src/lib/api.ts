import "server-only";
import { cookies } from "next/headers";

const API_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Server-side call to the API, forwarding the user's session cookie. */
export async function apiGet<T>(path: string): Promise<T> {
  const cookie = (await cookies()).toString();
  const res = await fetch(`${API_URL}${path}`, { headers: { cookie }, cache: "no-store" });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

/** Like apiGet but returns null for 401/404 (signed out / not a member). */
export async function apiGetOrNull<T>(path: string): Promise<T | null> {
  try {
    return await apiGet<T>(path);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) return null;
    throw error;
  }
}

export interface Me {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    isPlatformOwner: boolean;
  };
  activeTenantId: string | null;
  tenants: Array<{ tenantId: string; name: string; slug: string; role: string }>;
}

export interface TenantDetail {
  tenant: {
    id: string;
    name: string;
    countryCode: string;
    timezone: string;
    defaultLanguage: string;
    dataRegion: string;
    status: "onboarding" | "active" | "suspended";
    createdAt: string;
  };
  role: "owner" | "admin" | "staff";
  permissions: string[];
}

export interface AuditEntry {
  id: number;
  actorType: string;
  actorUserId: string | null;
  action: string;
  createdAt: string;
}

export const getMe = () => apiGetOrNull<Me>("/api/me");
