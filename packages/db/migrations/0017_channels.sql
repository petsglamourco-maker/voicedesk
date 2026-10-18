ALTER TYPE "public"."conversation_channel" ADD VALUE 'web_form';--> statement-breakpoint
CREATE TABLE "channel_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" "conversation_channel" NOT NULL,
	"external_id" text NOT NULL,
	"contact_id" uuid,
	"conversation_id" uuid,
	"mode" text DEFAULT 'ai' NOT NULL,
	"assignee_user_id" uuid,
	"needs_human" boolean DEFAULT false NOT NULL,
	"unread" integer DEFAULT 0 NOT NULL,
	"display_name" text,
	"subject" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_preview" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_endpoints" ADD CONSTRAINT "public_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_threads_tenant_channel_external_uq" ON "channel_threads" USING btree ("tenant_id","channel","external_id");--> statement-breakpoint
CREATE INDEX "channel_threads_tenant_last_idx" ON "channel_threads" USING btree ("tenant_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "public_endpoints_kind_key_uq" ON "public_endpoints" USING btree ("kind","key");--> statement-breakpoint
CREATE INDEX "public_endpoints_tenant_idx" ON "public_endpoints" USING btree ("tenant_id");