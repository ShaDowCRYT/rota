CREATE TYPE "public"."payment_kind" AS ENUM('initial', 'change');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"tx_ref" text NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"plan_id" text NOT NULL,
	"seats" integer NOT NULL,
	"quote" jsonb,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"provider_tx_id" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tx_ref_unique" UNIQUE("tx_ref"),
	CONSTRAINT "payments_amount_cents_check" CHECK ("payments"."amount_cents" >= 0),
	CONSTRAINT "payments_seats_check" CHECK ("payments"."seats" > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"event_key" text PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"tx_ref" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_team_created_idx" ON "payments" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_events_team_received_idx" ON "webhook_events" USING btree ("team_id","received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_processed_at_idx" ON "webhook_events" USING btree ("processed_at");