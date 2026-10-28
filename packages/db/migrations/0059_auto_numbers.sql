CREATE TABLE "number_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carrier" text DEFAULT 'twilio' NOT NULL,
	"number_type" text DEFAULT 'local' NOT NULL,
	"carrier_identity_id" text,
	"carrier_address_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"details" jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number_type" text DEFAULT 'local' NOT NULL,
	"kind" text DEFAULT 'included' NOT NULL,
	"e164" text NOT NULL,
	"area" text,
	"label" text,
	"status" text DEFAULT 'waiting_review' NOT NULL,
	"reason" text,
	"phone_number_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "carrier_number_id" text;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "number_type" text;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "billing" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD COLUMN "release_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "numbers" jsonb DEFAULT '{"autoBuy":false,"dailyLimit":5,"perBusiness":10}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "extra_numbers" jsonb DEFAULT '{"local":0,"mobile":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "number_identities" ADD CONSTRAINT "number_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_orders" ADD CONSTRAINT "number_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_orders" ADD CONSTRAINT "number_orders_phone_number_id_phone_numbers_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_numbers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "number_identities_tenant_type_uq" ON "number_identities" USING btree ("tenant_id","number_type");--> statement-breakpoint
CREATE INDEX "number_orders_status_idx" ON "number_orders" USING btree ("status");