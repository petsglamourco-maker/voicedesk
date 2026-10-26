ALTER TABLE "agent_settings" ADD COLUMN "review_requests" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "review_link" text;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "value_report" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "value_report_sent_for" text;--> statement-breakpoint
ALTER TABLE "agent_settings" ADD COLUMN "average_booking_pence" integer;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "review_offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "review_clicked_at" timestamp with time zone;