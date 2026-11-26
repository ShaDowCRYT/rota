CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"included_seats" integer NOT NULL,
	"extra_seat_cents" integer,
	"max_seats" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_price_cents_check" CHECK ("plans"."price_cents" >= 0),
	CONSTRAINT "plans_included_seats_check" CHECK ("plans"."included_seats" > 0),
	CONSTRAINT "plans_max_seats_check" CHECK ("plans"."max_seats" >= "plans"."included_seats"),
	CONSTRAINT "plans_extra_seat_cents_check" CHECK ("plans"."extra_seat_cents" is null or "plans"."extra_seat_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO "plans" ("id", "name", "price_cents", "included_seats", "extra_seat_cents", "max_seats")
VALUES
	('starter', 'Starter', 2000, 5, NULL, 5),
	('team', 'Team', 5000, 15, 300, 25),
	('business', 'Business', 12000, 40, 200, 100)
ON CONFLICT ("id") DO NOTHING;
