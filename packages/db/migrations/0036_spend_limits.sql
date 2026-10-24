CREATE TABLE "spend_alerts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spend_alerts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"category" text NOT NULL,
	"level" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "spend_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"units" integer NOT NULL,
	"amount_pence" numeric(12, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"spend" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "ai_cap_pence" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "sms_cap_pence" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "calls_cap_pence" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "answerers_can_call_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_alerts" ADD CONSTRAINT "spend_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_events" ADD CONSTRAINT "spend_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spend_alerts_once_idx" ON "spend_alerts" USING btree ("tenant_id","month","category","level");--> statement-breakpoint
CREATE INDEX "spend_events_tenant_created_idx" ON "spend_events" USING btree ("tenant_id","created_at");