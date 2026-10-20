ALTER TABLE "contacts" ADD COLUMN "do_not_call" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "direction" text DEFAULT 'inbound' NOT NULL;