import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

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
  if (res.status === 403) {
    // A feature that needs two-step login: send them to turn it on (security audit C1).
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === "MFA_REQUIRED") redirect("/mfa-required");
  }
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
  /** Two-step login: required for this person, and the deadline while in the grace period. */
  mfa: { required: boolean; deadline: string | null };
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

/** Monthly spending limits (ADR 0022); amounts in pence. */
export type SpendCategory = "ai" | "sms" | "calls";
export interface BillingPlan {
  id: "trial" | "starter" | "growth" | "pro";
  name: string;
  pricePence: number;
  minutes: number;
  texts: number;
  aiPence: number;
  phoneNumbers: number;
  seats: number;
  features: Array<
    "whatsapp" | "va_console" | "feedback" | "daily_brief" | "ai_calls" | "departments"
  >;
}

/** One department of the phone menu (ADR 0025). */
export interface DepartmentInput {
  id?: string;
  key: number;
  name: string;
  spokenNames: Record<string, string>;
  instructions: string | null;
  routing: "people_then_phone" | "people_only" | "phone_only" | "message_only";
  transferPhone: string | null;
  notifyEmail: string | null;
  paymentLink: string | null;
  ringFirst: boolean;
  enabled: boolean;
  memberIds: string[];
}

/** GET /api/tenants/:id/departments. */
export interface DepartmentsView {
  menuEnabled: boolean;
  menuHours: "always" | "open";
  menuOnChat: boolean;
  departments: Array<DepartmentInput & { id: string }>;
  preview: string | null;
  team: Array<{ userId: string; name: string }>;
  planAllows: boolean;
  canEdit: boolean;
}

/** GET /api/tenants/:id/today (ADR 0024). */
export interface TodayView {
  date: string;
  timezone: string;
  bookings: Array<{
    id: string;
    startsAt: string;
    endsAt: string | null;
    service: string | null;
    customerName: string | null;
    status: string;
  }>;
  waitingChats: {
    count: number;
    items: Array<{
      id: string;
      channel: string;
      displayName: string | null;
      lastMessageAt: string;
    }>;
  };
  missedCalls: {
    count: number;
    items: Array<{ conversationId: string; at: string; urgent: boolean }>;
  };
  callbacks: { count: number };
  messages: {
    count: number;
    items: Array<{
      id: string;
      callerName: string | null;
      reason: string;
      urgency: string;
      createdAt: string;
    }>;
  };
}

/** GET /api/tenants/:id/billing (ADR 0023). */
export interface BillingView {
  plan: BillingPlan;
  status: "trialing" | "active" | "past_due" | "canceled";
  usable: boolean;
  reason: "trial_ended" | "canceled" | "unpaid" | null;
  comped: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  hasBillingAccount: boolean;
  billingReady: boolean;
  canManage: boolean;
  plans: Array<BillingPlan & { available: boolean }>;
}

export interface SpendView {
  month: string;
  categories: Record<
    SpendCategory,
    { spent: number; cap: number; state: "ok" | "warning" | "reached" }
  >;
  allowance: Record<SpendCategory, number>;
  caps: Record<SpendCategory, number>;
  /** The platform lets businesses choose their own limits within the allowance. */
  businessCaps: boolean;
  canEdit: boolean;
  paused: { outboundCalls: boolean; sms: boolean; ai: boolean };
  suspended: boolean;
}
