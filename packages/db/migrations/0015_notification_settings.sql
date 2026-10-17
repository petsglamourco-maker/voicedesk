ALTER TABLE "agent_settings" ADD COLUMN "reminder_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "customer_confirmations" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "alert_phone" text;