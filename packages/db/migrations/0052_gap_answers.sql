CREATE TABLE "gap_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"question" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"last_asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"draft" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"drafted_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD COLUMN "gap_answer_id" uuid;--> statement-breakpoint
ALTER TABLE "gap_answers" ADD CONSTRAINT "gap_answers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap_answers" ADD CONSTRAINT "gap_answers_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gap_answers_tenant_status_idx" ON "gap_answers" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_gap_answer_id_gap_answers_id_fk" FOREIGN KEY ("gap_answer_id") REFERENCES "public"."gap_answers"("id") ON DELETE set null ON UPDATE no action;