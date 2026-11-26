CREATE TYPE "public"."ledger_entry_type" AS ENUM('charge', 'credit', 'refund', 'adjustment', 'plan_change', 'seat_change', 'renewal');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('none', 'active', 'past_due', 'restricted');--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"ref" text NOT NULL,
	"plan_id" text,
	"seats" integer,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"idempotency_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"seats" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" "subscription_status" DEFAULT 'none' NOT NULL,
	"pending_plan_id" text,
	"pending_seats" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_seats_check" CHECK ("subscriptions"."seats" > 0),
	CONSTRAINT "subscriptions_pending_seats_check" CHECK ("subscriptions"."pending_seats" is null or "subscriptions"."pending_seats" > 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_team_created_idx" ON "ledger_entries" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_team_idempotency_ref_idx" ON "ledger_entries" USING btree ("team_id","idempotency_ref") WHERE "ledger_entries"."idempotency_ref" is not null;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_ledger_entries_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'ledger_entries is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION prevent_ledger_entries_mutation();