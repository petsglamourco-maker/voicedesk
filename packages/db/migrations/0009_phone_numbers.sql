CREATE TYPE "public"."phone_number_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"e164" text NOT NULL,
	"provider" text DEFAULT 'twilio' NOT NULL,
	"label" text,
	"status" "phone_number_status" DEFAULT 'active' NOT NULL,
	"livekit_trunk_id" text,
	"livekit_dispatch_rule_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "phone_number_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "caller_number_withheld" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "recording_key" text;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_numbers_e164_idx" ON "phone_numbers" USING btree ("e164");--> statement-breakpoint
CREATE INDEX "phone_numbers_tenant_idx" ON "phone_numbers" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_phone_number_id_phone_numbers_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_numbers"("id") ON DELETE set null ON UPDATE no action;