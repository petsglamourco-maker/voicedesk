ALTER TABLE "agent_settings" ADD COLUMN "transfer_phone" text;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "transfer_hours" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "on_call_phone" text;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "urgent_situations" text;