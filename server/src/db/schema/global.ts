import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Global group: users stay in the shared database because they are not owned by a team.
export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash"),
    googleSub: text("google_sub").unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("users_email_lowercase_check", sql`${table.email} = lower(${table.email})`),
  ],
);

// Global group: refresh tokens follow a user, not a team, so they stay in the shared database.
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("refresh_tokens_user_id_idx").on(table.userId),
    index("refresh_tokens_family_id_idx").on(table.familyId),
  ],
);

// Global group: this lookup connects users to teams, but team_id is only an ID because teams live in shard databases.
export const userTeams = pgTable(
  "user_teams",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.teamId] }),
    index("user_teams_team_id_idx").on(table.teamId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    teamId: uuid("team_id").notNull(),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email"),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("invites_team_id_idx").on(table.teamId),
    check("invites_role_check", sql`${table.role} in ('manager', 'staff')`),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("password_reset_tokens_user_id_idx").on(table.userId)],
);

// Global group: plan definitions are shared product data, not owned by a team.
export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
    includedSeats: integer("included_seats").notNull(),
    extraSeatCents: integer("extra_seat_cents"),
    maxSeats: integer("max_seats").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("plans_price_cents_check", sql`${table.priceCents} >= 0`),
    check("plans_included_seats_check", sql`${table.includedSeats} > 0`),
    check("plans_max_seats_check", sql`${table.maxSeats} >= ${table.includedSeats}`),
    check(
      "plans_extra_seat_cents_check",
      sql`${table.extraSeatCents} is null or ${table.extraSeatCents} >= 0`,
    ),
  ],
);
