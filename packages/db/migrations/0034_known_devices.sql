CREATE TABLE "known_devices" (
	"user_id" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "known_devices_user_id_device_hash_pk" PRIMARY KEY("user_id","device_hash")
);
--> statement-breakpoint
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;