/**
 * Makes the VAPID keys that sign push notifications (ADR 0024) and prints the .env lines.
 * Free and local. Usage: pnpm push:keys (then restart VoiceDesk).
 */
import { generatePushKeys } from "@voicedesk/adapters/push/web-push";

const keys = generatePushKeys();
console.log("Add these lines to .env, then restart VoiceDesk:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com   # your contact address");
console.log("\nKeep the private key secret. Changing the keys turns notifications off on every");
console.log("device until people turn them on again.");
