CREATE TABLE "demo_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"website" text NOT NULL,
	"business_name" text,
	"email" text,
	"consent_at" timestamp with time zone,
	"ip_hash" text,
	"status" text DEFAULT 'crawling' NOT NULL,
	"cost_usd" numeric(10, 6),
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "demos" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"website" text NOT NULL,
	"status" text DEFAULT 'crawling' NOT NULL,
	"error" text,
	"chat_turns" integer DEFAULT 0 NOT NULL,
	"voice_calls" integer DEFAULT 0 NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "demo_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "demos" jsonb DEFAULT '{"enabled":false,"dailyLimit":5}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "demo_requests" ADD CONSTRAINT "demo_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demos" ADD CONSTRAINT "demos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_requests_created_idx" ON "demo_requests" USING btree ("created_at");