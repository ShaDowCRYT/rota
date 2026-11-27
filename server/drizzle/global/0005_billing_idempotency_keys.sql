CREATE TYPE "public"."idempotency_key_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" "idempotency_key_status" NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;