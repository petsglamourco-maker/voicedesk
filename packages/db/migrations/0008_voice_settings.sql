ALTER TABLE "agent_settings" ADD COLUMN "record_calls" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "voice_ids" jsonb DEFAULT '{}'::jsonb NOT NULL;