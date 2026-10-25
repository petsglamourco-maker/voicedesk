/** Shared by the call list and call detail pages. */

import type { StatusTone } from "@voicedesk/ui";
import {
  CircleCheck,
  CircleDashed,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

export interface CallRow {
  id: string;
  test: boolean;
  status: string;
  startedAt: string;
  durationSeconds: number | null;
  language: string;
  flow: string;
  calledNumber: string | null;
  /** twilio / telnyx for phone calls; null for browser tests. */
  carrier: string | null;
  /** "inbound", or "outbound" when someone at the VA console dialled out. */
  direction?: string;
  callerPhone: string | null;
  callerWithheld: boolean;
  records: Array<{ type: string; reference: string }>;
  intent: string | null;
  outcome: string | null;
  hasRecording: boolean;
  medianLatencyMs: number | null;
  /** ADR 0025: the caller's department, and whether the team missed the call first. */
  departmentId?: string | null;
  department?: string | null;
  missedByTeam?: boolean;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "–";
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Latency status as a Badge tone plus an icon against the brief's target (median under 800 ms); colour is never the only signal. */
export function latencyStatus(ms: number | null): { tone: StatusTone; icon: LucideIcon } {
  if (ms === null) return { tone: "neutral", icon: CircleDashed };
  if (ms <= 800) return { tone: "success", icon: CircleCheck };
  if (ms <= 1500) return { tone: "warning", icon: TriangleAlert };
  return { tone: "danger", icon: OctagonAlert };
}
