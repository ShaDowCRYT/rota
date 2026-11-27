ALTER TYPE "public"."payment_kind" ADD VALUE 'renewal';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "grace_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_notice" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_kind_status_updated_idx" ON "payments" USING btree ("kind","status","updated_at");--> statement-breakpoint
CREATE INDEX "subscriptions_status_period_end_idx" ON "subscriptions" USING btree ("status","period_end");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_last_notice_check" CHECK ("subscriptions"."last_notice" between 0 and 3);