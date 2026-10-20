/** Shared by the call list and call detail pages. */

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
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "–";
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Latency badge colour against the brief's target (median under 800 ms). */
export function latencyTone(ms: number | null): string {
  if (ms === null) return "";
  if (ms <= 800) return "border-success/40 text-success";
  if (ms <= 1500) return "border-warning/40 text-warning";
  return "border-danger/40 text-danger";
}
