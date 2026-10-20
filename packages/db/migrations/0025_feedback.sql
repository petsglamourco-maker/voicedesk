CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"contact_id" uuid,
	"channel" text NOT NULL,
	"kind" text DEFAULT 'csat' NOT NULL,
	"token" text NOT NULL,
	"handled_by" text DEFAULT 'ai' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"score" integer,
	"comment" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "feedback_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "feedback_after_calls" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "nps_every" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_token_uq" ON "feedback" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_conversation_uq" ON "feedback" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "feedback_tenant_sent_idx" ON "feedback" USING btree ("tenant_id","sent_at");