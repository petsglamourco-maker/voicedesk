CREATE TABLE "outbound_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"phone" text NOT NULL,
	"contact_id" uuid,
	"booking_id" uuid,
	"reason" text,
	"source_type" text,
	"source_id" uuid,
	"language" text,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 2 NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"outcome" text,
	"conversation_id" uuid,
	"last_attempt_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "ai_callbacks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "confirmation_calls" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "outbound_daily_cap" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_calls" ADD CONSTRAINT "outbound_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_calls" ADD CONSTRAINT "outbound_calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_calls" ADD CONSTRAINT "outbound_calls_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_calls" ADD CONSTRAINT "outbound_calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbound_calls_due_idx" ON "outbound_calls" USING btree ("status","not_before");--> statement-breakpoint
CREATE INDEX "outbound_calls_tenant_idx" ON "outbound_calls" USING btree ("tenant_id","created_at");