ALTER TABLE "handoffs" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_department_id_departments_id_fk"
  FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL;
