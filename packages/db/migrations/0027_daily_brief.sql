ALTER TABLE "agent_settings" ADD COLUMN "daily_brief" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "brief_sent_on" text;