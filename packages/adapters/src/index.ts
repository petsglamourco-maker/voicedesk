// Provider-agnostic interfaces. Business logic depends only on these types.
// Concrete providers are imported from their subpaths (e.g. "@voicedesk/adapters/email/smtp").
export * from "./errors";
export type * from "./calendar/types";
export type * from "./email/types";
export type * from "./embeddings/types";
export type * from "./llm/types";
export { responseText } from "./llm/types";
export { estimateCostUsd } from "./llm/pricing";
export type * from "./messaging/types";
export type * from "./speech/types";
export type * from "./telephony/types";
export type * from "./storage/types";
export { tenantKey } from "./storage/types";
export * from "./mocks";
