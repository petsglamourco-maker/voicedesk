CREATE TABLE "agent_presence" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "va_assignments" ADD COLUMN "source" text DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "va_assignments" ADD COLUMN "created_membership" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_presence" ADD CONSTRAINT "agent_presence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;