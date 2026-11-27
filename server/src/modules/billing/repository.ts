import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import { plans, users } from "../../db/schema/global.js";
import {
  ledgerEntries,
  memberships,
  subscriptions,
  teams,
} from "../../db/schema/shard.js";
import { invites } from "../../db/schema/global.js";
import { getAllShards, getShardFor } from "../../db/shard.js";
import type { SqlExecutor } from "../../db/types.js";
import type {
  BillingRepository,
  LedgerEntryRow,
  PlanRow,
  SubscriptionRow,
} from "./types.js";
import type { LedgerEntryType, SubscriptionStatus } from "./types.js";
import type { PlanId } from "./proration.js";

function toPlan(row: typeof plans.$inferSelect): PlanRow {
  return {
    id: row.id as PlanId,
    name: row.name,
    priceCents: row.priceCents,
    includedSeats: row.includedSeats,
    extraSeatCents: row.extraSeatCents,
    maxSeats: row.maxSeats,
  };
}

function toSubscription(row: typeof subscriptions.$inferSelect): SubscriptionRow {
  return {
    teamId: row.teamId,
    planId: row.planId as PlanId,
    seats: row.seats,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status as SubscriptionStatus,
    pendingPlanId: (row.pendingPlanId as PlanId | null) ?? null,
    pendingSeats: row.pendingSeats,
    graceEndsAt: row.graceEndsAt,
    lastNotice: row.lastNotice,
    updatedAt: row.updatedAt,
  };
}

function toLedger(row: typeof ledgerEntries.$inferSelect): LedgerEntryRow {
  return {
    id: row.id,
    teamId: row.teamId,
    type: row.type as LedgerEntryType,
    amountCents: row.amountCents,
    currency: row.currency,
    ref: row.ref,
    planId: (row.planId as PlanId | null) ?? null,
    seats: row.seats,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    idempotencyRef: row.idempotencyRef,
    createdAt: row.createdAt,
  };
}

export function createBillingRepository(db: Database): BillingRepository {
  return {
    async listPlans() {
      const rows = await db.select().from(plans).orderBy(sql`${plans.priceCents} asc`);
      return rows.map(toPlan);
    },

    async findPlan(planId) {
      const rows = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toPlan(row);
    },

    async getSubscription(teamId, executor?: SqlExecutor) {
      const shard = executor ?? getShardFor(teamId);
      const rows = await (shard as Database)
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.teamId, teamId))
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toSubscription(row);
    },

    async upsertSubscription(executor: SqlExecutor, input) {
      const dbx = executor as Database;
      await dbx
        .insert(subscriptions)
        .values({
          teamId: input.teamId,
          planId: input.planId,
          seats: input.seats,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          status: input.status,
          pendingPlanId: input.pendingPlanId,
          pendingSeats: input.pendingSeats,
          graceEndsAt: input.graceEndsAt,
          lastNotice: input.lastNotice,
          updatedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: subscriptions.teamId,
          set: {
            planId: input.planId,
            seats: input.seats,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            status: input.status,
            pendingPlanId: input.pendingPlanId,
            pendingSeats: input.pendingSeats,
            graceEndsAt: input.graceEndsAt,
            lastNotice: input.lastNotice,
            updatedAt: sql`now()`,
          },
        });
    },

    async appendLedgerEntry(executor: SqlExecutor, input) {
      const dbx = executor as Database;
      const rows = await dbx
        .insert(ledgerEntries)
        .values({
          ...(input.id === undefined ? {} : { id: input.id }),
          teamId: input.teamId,
          type: input.type,
          amountCents: input.amountCents,
          currency: input.currency,
          ref: input.ref,
          planId: input.planId,
          seats: input.seats,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          idempotencyRef: input.idempotencyRef,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error("ledger insert returned no row");
      }
      return toLedger(row);
    },

    async listLedgerEntries(teamId) {
      const shard = getShardFor(teamId);
      const rows = await shard
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.teamId, teamId))
        .orderBy(sql`${ledgerEntries.createdAt} asc`, sql`${ledgerEntries.id} asc`);
      return rows.map(toLedger);
    },

    async countSeatsUsed(teamId) {
      const shard = getShardFor(teamId);
      const membershipRows = await shard
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .where(eq(memberships.teamId, teamId));
      const memberCount = membershipRows[0]?.count ?? 0;

      const inviteRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(invites)
        .where(
          and(
            eq(invites.teamId, teamId),
            isNull(invites.usedAt),
            isNull(invites.revokedAt),
            gt(invites.expiresAt, sql`now()`),
          ),
        );
      const inviteCount = inviteRows[0]?.count ?? 0;
      return memberCount + inviteCount;
    },

    async getTeamOwnerId(teamId, executor) {
      const shard = executor ?? getShardFor(teamId);
      const rows = await (shard as Database)
        .select({ ownerId: teams.ownerId })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);
      return rows[0]?.ownerId;
    },

    async getOwnerEmail(userId) {
      const rows = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0]?.email;
    },

    async listSubscriptionsForMaintenance(now, limit) {
      const rows: ReturnType<typeof toSubscription>[] = [];
      for (const shard of getAllShards()) {
        const found = await shard
          .select()
          .from(subscriptions)
          .where(
            and(
              inArray(subscriptions.status, ["active", "past_due"]),
              or(lte(subscriptions.periodEnd, now), lte(subscriptions.graceEndsAt, now)),
            ),
          )
          .orderBy(subscriptions.periodEnd)
          .limit(limit);
        rows.push(...found.map(toSubscription));
        if (rows.length >= limit) break;
      }
      return rows.slice(0, limit);
    },
  };
}
