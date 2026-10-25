CREATE TABLE "department_members" (
	"tenant_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department_moves" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "department_moves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"department_id" uuid,
	"via" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" integer NOT NULL,
	"name" text NOT NULL,
	"spoken_names" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"instructions" text,
	"routing" text DEFAULT 'people_then_phone' NOT NULL,
	"transfer_phone" text,
	"notify_email" text,
	"payment_link" text,
	"ring_first" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "menu_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "menu_hours" text DEFAULT 'always' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "menu_on_chat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "call_entry" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "ring_first" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "entry" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_moves" ADD CONSTRAINT "department_moves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_moves" ADD CONSTRAINT "department_moves_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_moves" ADD CONSTRAINT "department_moves_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "department_members_uq" ON "department_members" USING btree ("department_id","user_id");--> statement-breakpoint
CREATE INDEX "department_moves_conversation_idx" ON "department_moves" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_tenant_key_uq" ON "departments" USING btree ("tenant_id","key");