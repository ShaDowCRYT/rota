import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "manager",
  "staff",
]);

// Shard group: teams are routed by team_id, so this table moves with its shard.
export const teams = pgTable("teams", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ownerId: uuid("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Shard group: memberships are team data; user_id is a plain UUID because users live in the global database.
export const memberships = pgTable(
  "memberships",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    userId: uuid("user_id").notNull(),
    role: membershipRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] })],
);

export const swapRequestStatus = pgEnum("swap_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    assigneeId: uuid("assignee_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("shifts_time_order_check", sql`${table.endsAt} > ${table.startsAt}`),
    index("shifts_team_starts_idx").on(table.teamId, table.startsAt),
  ],
);

export const swapRequests = pgTable(
  "swap_requests",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "cascade" }),
    requesterId: uuid("requester_id").notNull(),
    targetId: uuid("target_id"),
    status: swapRequestStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("swap_requests_one_pending_idx")
      .on(table.shiftId)
      .where(sql`${table.status} = 'pending'`),
    index("swap_requests_team_status_idx").on(table.teamId, table.status),
  ],
);

export const activityEvents = pgTable("activity_events", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id),
  type: text("type").notNull(),
  actorId: uuid("actor_id").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  index("activity_events_team_created_id_idx").on(
    table.teamId,
    table.createdAt.desc(),
    table.id.desc(),
  ),
]);

export const subscriptionStatus = pgEnum("subscription_status", [
  "none",
  "active",
  "past_due",
  "restricted",
]);

export const ledgerEntryType = pgEnum("ledger_entry_type", [
  "charge",
  "credit",
  "refund",
  "adjustment",
  "plan_change",
  "seat_change",
  "renewal",
]);

// Shard group: subscriptions belong to a team. plan_id is a plain text ID because plans live in the global database.
export const subscriptions = pgTable(
  "subscriptions",
  {
    teamId: uuid("team_id")
      .primaryKey()
      .references(() => teams.id),
    planId: text("plan_id").notNull(),
    seats: integer("seats").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    status: subscriptionStatus("status").notNull().default("none"),
    pendingPlanId: text("pending_plan_id"),
    pendingSeats: integer("pending_seats"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("subscriptions_seats_check", sql`${table.seats} > 0`),
    check(
      "subscriptions_pending_seats_check",
      sql`${table.pendingSeats} is null or ${table.pendingSeats} > 0`,
    ),
  ],
);

// Shard group: ledger entries are team billing history. Append-only is enforced by a migration trigger.
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    type: ledgerEntryType("type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    ref: text("ref").notNull(),
    planId: text("plan_id"),
    seats: integer("seats"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    idempotencyRef: text("idempotency_ref"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ledger_entries_team_created_idx").on(table.teamId, table.createdAt),
    uniqueIndex("ledger_entries_team_idempotency_ref_idx")
      .on(table.teamId, table.idempotencyRef)
      .where(sql`${table.idempotencyRef} is not null`),
  ],
);
