CREATE TYPE "public"."ai_provider_kind" AS ENUM('anthropic', 'openai_compatible');--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" "ai_provider_kind" NOT NULL,
	"name" text NOT NULL,
	"base_url" text,
	"api_key_encrypted" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"priority" integer NOT NULL,
	"models" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"notes" text,
	"last_test" jsonb,
	"updated_by" uuid,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_key_unique" UNIQUE("key")
);
