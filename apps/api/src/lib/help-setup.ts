import {
  agentSettings,
  businessProfiles,
  calendarConnections,
  knowledgeSources,
  mailboxes,
  phoneNumbers,
  publicEndpoints,
  vaAssignments,
  withTenant,
  type Database,
} from "@voicedesk/db";
import { and, eq } from "drizzle-orm";
import { setupStatus } from "./setup";

/**
 * Yes/no facts about a business's setup for the Help assistant (ADR 0021): enough to say
 * "your calendar isn't connected yet", never customer data, names, numbers or keys.
 */
export async function helpSetupFacts(
  db: Database,
  tenantId: string,
  ai: { enabledReady: number },
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const facts = await withTenant(db, tenantId, async (tx) => {
    const profiles = await tx
      .select({ status: businessProfiles.status })
      .from(businessProfiles)
      .where(eq(businessProfiles.tenantId, tenantId));
    const sources = await tx
      .select({ status: knowledgeSources.status })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.tenantId, tenantId));
    const [calendar] = await tx
      .select({ calendarId: calendarConnections.calendarId, status: calendarConnections.status })
      .from(calendarConnections)
      .where(eq(calendarConnections.tenantId, tenantId));
    const numbers = await tx
      .select({ id: phoneNumbers.id })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.tenantId, tenantId), eq(phoneNumbers.status, "active")));
    const endpoints = await tx
      .select({
        kind: publicEndpoints.kind,
        enabled: publicEndpoints.enabled,
        config: publicEndpoints.config,
      })
      .from(publicEndpoints)
      .where(eq(publicEndpoints.tenantId, tenantId));
    const [mailbox] = await tx
      .select({ status: mailboxes.status })
      .from(mailboxes)
      .where(eq(mailboxes.tenantId, tenantId));
    const answerers = await tx
      .select({ userId: vaAssignments.userId })
      .from(vaAssignments)
      .where(eq(vaAssignments.tenantId, tenantId));
    const [settings] = await tx
      .select({
        recordCalls: agentSettings.recordCalls,
        feedbackEnabled: agentSettings.feedbackEnabled,
        dailyBrief: agentSettings.dailyBrief,
      })
      .from(agentSettings)
      .where(eq(agentSettings.tenantId, tenantId));
    return { profiles, sources, calendar, numbers, endpoints, mailbox, answerers, settings };
  });

  const widget = facts.endpoints.find((e) => e.kind === "widget");
  const origins = (widget?.config as { allowedOrigins?: unknown[] } | undefined)?.allowedOrigins;
  const count = (status: string) => facts.sources.filter((s) => s.status === status).length;
  const server = Object.fromEntries(setupStatus(env, ai).map((i) => [i.id, i.state]));

  return {
    businessProfile: {
      approved: facts.profiles.some((p) => p.status === "approved"),
      draftWaitingForApproval: facts.profiles.some((p) => p.status === "draft"),
    },
    knowledgeSources: {
      ready: count("ready"),
      stillReading: count("pending") + count("processing"),
      failed: count("failed"),
    },
    calendar: !facts.calendar
      ? "not connected"
      : facts.calendar.status === "revoked"
        ? "needs reconnecting"
        : !facts.calendar.calendarId
          ? "connected, but no calendar chosen yet"
          : facts.calendar.status === "error"
            ? "connected, last sync had a problem"
            : "connected",
    phoneNumbersAssigned: facts.numbers.length,
    websiteChat: { on: widget?.enabled ?? false, allowedWebsitesSet: Boolean(origins?.length) },
    whatsappNumberAssigned: facts.endpoints.some((e) => e.kind === "whatsapp" && e.enabled),
    emailInbox: !facts.mailbox
      ? "not connected"
      : facts.mailbox.status === "active"
        ? "connected"
        : "connected, but has a problem",
    hostedFormOn: facts.endpoints.some((e) => e.kind === "form" && e.enabled),
    peopleWhoAnswerCalls: facts.answerers.length,
    callRecording: facts.settings?.recordCalls ?? false,
    feedbackSurveys: facts.settings?.feedbackEnabled ?? true,
    dailyBriefEmail: facts.settings?.dailyBrief ?? true,
    /** Server-wide features: ready, local (this computer only) or off (the platform owner sets them up). */
    serverFeatures: server,
  };
}
