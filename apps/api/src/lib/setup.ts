/**
 * Which features are ready on this server, and what each still needs (Platform admin → Setup).
 * Reports setting NAMES only — never values.
 */
export type SetupState = "ready" | "local" | "off";

export interface SetupItem {
  id:
    | "ai"
    | "voice"
    | "phone"
    | "email"
    | "sms"
    | "googleCalendar"
    | "microsoftCalendar"
    | "mailbox"
    | "whatsapp"
    | "outbound"
    | "publicAddress";
  state: SetupState;
  /** .env names (or a short instruction code) still needed for "ready". */
  missing: string[];
  /** Whether using it costs money once set up. */
  paid: boolean;
}

const has = (env: NodeJS.ProcessEnv, name: string) => Boolean(env[name]?.trim());
const lacking = (env: NodeJS.ProcessEnv, names: string[]) => names.filter((n) => !has(env, n));
const isLocalHost = (value: string | undefined) =>
  !value || /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|mailpit)([:/]|$)/i.test(value);

export function setupStatus(env: NodeJS.ProcessEnv, ai: { enabledReady: number }): SetupItem[] {
  const item = (id: SetupItem["id"], missing: string[], paid: boolean): SetupItem => ({
    id,
    state: missing.length ? "off" : "ready",
    missing,
    paid,
  });

  const livekit = lacking(env, ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]);

  // Outgoing email: Mailpit (local) unless a real SMTP server with a login is set.
  const email: SetupItem = isLocalHost(env.SMTP_HOST)
    ? {
        id: "email",
        state: "local",
        missing: ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"],
        paid: false,
      }
    : item("email", lacking(env, ["SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"]), false);

  // SMS: Mailpit by default; real texts need a carrier's keys and a sender.
  const smsNames = (env.SMS_PROVIDER ?? "mailpit")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const carriers = smsNames.filter((n) => n === "twilio" || n === "telnyx");
  let sms: SetupItem;
  if (carriers.length === 0) {
    sms = { id: "sms", state: "local", missing: ["SMS_PROVIDER"], paid: true };
  } else {
    const needed = carriers.flatMap((c) =>
      c === "twilio" ? ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] : ["TELNYX_API_KEY"],
    );
    sms = item("sms", lacking(env, [...needed, "SMS_FROM"]), true);
  }

  // Outbound calls: either carrier's SIP termination login (Telnyx has a default host).
  const twilioOut = lacking(env, [
    "SIP_OUTBOUND_TWILIO_HOST",
    "SIP_OUTBOUND_TWILIO_USERNAME",
    "SIP_OUTBOUND_TWILIO_PASSWORD",
  ]);
  const telnyxOut = lacking(env, ["SIP_OUTBOUND_TELNYX_USERNAME", "SIP_OUTBOUND_TELNYX_PASSWORD"]);
  const outboundMissing =
    twilioOut.length === 0 || telnyxOut.length === 0 ? [] : [...livekit, ...twilioOut];

  return [
    item("ai", ai.enabledReady > 0 ? [] : ["AI_PROVIDER_ON"], true),
    item("voice", [...livekit, ...lacking(env, ["DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY"])], true),
    item("phone", [...livekit, ...lacking(env, ["SIP_AUTH_USERNAME", "SIP_AUTH_PASSWORD"])], true),
    email,
    sms,
    item("googleCalendar", lacking(env, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]), false),
    item(
      "microsoftCalendar",
      lacking(env, ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]),
      false,
    ),
    item("mailbox", lacking(env, ["SETTINGS_ENCRYPTION_KEY"]), false),
    item(
      "whatsapp",
      lacking(env, ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]),
      true,
    ),
    item("outbound", outboundMissing, true),
    isLocalHost(env.WEB_ORIGIN)
      ? { id: "publicAddress", state: "local", missing: ["WEB_ORIGIN"], paid: true }
      : item("publicAddress", [], true),
  ];
}
