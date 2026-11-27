import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import { payments, webhookEvents } from "../../db/schema/shard.js";
import { getAllShards, getShardFor } from "../../db/shard.js";
import type { SqlExecutor } from "../../db/types.js";
import { isUniqueViolation } from "../../lib/errors.js";

export interface PaymentRow {
  id: string;
  teamId: string;
  txRef: string;
  kind: "initial" | "change" | "renewal";
  amountCents: number;
  currency: string;
  planId: string;
  seats: number;
  quote: unknown | null;
  status: "pending" | "succeeded" | "failed" | "expired";
  providerTxId: string | null;
  checkoutUrl: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookEventRow {
  eventKey: string;
  teamId: string;
  provider: string;
  txRef: string;
  payload: unknown;
  receivedAt: Date;
  processedAt: Date | null;
  attempts: number;
}

function toPayment(row: typeof payments.$inferSelect): PaymentRow {
  return {
    id: row.id,
    teamId: row.teamId,
    txRef: row.txRef,
    kind: row.kind as PaymentRow["kind"],
    amountCents: row.amountCents,
    currency: row.currency,
    planId: row.planId,
    seats: row.seats,
    quote: row.quote ?? null,
    status: row.status as PaymentRow["status"],
    providerTxId: row.providerTxId ?? null,
    checkoutUrl: row.checkoutUrl ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toWebhook(row: typeof webhookEvents.$inferSelect): WebhookEventRow {
  return {
    eventKey: row.eventKey,
    teamId: row.teamId,
    provider: row.provider,
    txRef: row.txRef,
    payload: row.payload,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt ?? null,
    attempts: row.attempts,
  };
}

export function createPaymentRepository() {
  return {
    async createPayment(
      executor: SqlExecutor,
        row: Omit<PaymentRow, "createdAt" | "updatedAt" | "providerTxId" | "status" | "checkoutUrl"> & {
          status?: PaymentRow["status"];
          providerTxId?: string | null;
          checkoutUrl?: string | null;
        },
      ): Promise<void> {
        const dbx = executor as Database;
        await dbx.insert(payments).values({
          id: row.id,
          teamId: row.teamId,
          txRef: row.txRef,
          kind: row.kind,
          amountCents: row.amountCents,
          currency: row.currency,
          planId: row.planId,
          seats: row.seats,
          quote: row.quote,
          status: row.status ?? "pending",
          providerTxId: row.providerTxId ?? null,
          checkoutUrl: row.checkoutUrl ?? null,
          createdBy: row.createdBy,
          updatedAt: sql`now()`,
        });
      },

    async markPaymentFailed(executor: SqlExecutor, txRef: string): Promise<void> {
      const dbx = executor as Database;
      await dbx
        .update(payments)
        .set({ status: "failed", updatedAt: sql`now()` })
        .where(and(eq(payments.txRef, txRef), eq(payments.status, "pending")));
    },

    async insertRenewalPaymentIfMissing(
      executor: SqlExecutor,
      row: Omit<PaymentRow, "createdAt" | "updatedAt" | "providerTxId" | "status" | "checkoutUrl">,
    ): Promise<boolean> {
      const dbx = executor as Database;
      try {
        await dbx.insert(payments).values({
          id: row.id,
          teamId: row.teamId,
          txRef: row.txRef,
          kind: "renewal",
          amountCents: row.amountCents,
          currency: row.currency,
          planId: row.planId,
          seats: row.seats,
          quote: row.quote,
          status: "pending",
          providerTxId: null,
          checkoutUrl: null,
          createdBy: row.createdBy,
          updatedAt: sql`now()`,
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },

    async markPaymentSucceeded(
      executor: SqlExecutor,
      txRef: string,
      providerTxId: string,
    ): Promise<boolean> {
      const dbx = executor as Database;
      const rows = await dbx
        .update(payments)
        .set({ status: "succeeded", providerTxId, updatedAt: sql`now()` })
        .where(and(eq(payments.txRef, txRef), inArray(payments.status, ["pending", "expired"])))
        .returning({ id: payments.id });
      return rows.length > 0;
    },

    async markPaymentFailedForVerification(
      executor: SqlExecutor,
      txRef: string,
      providerTxId: string,
    ): Promise<boolean> {
      const dbx = executor as Database;
      const rows = await dbx
        .update(payments)
        .set({ status: "failed", providerTxId, updatedAt: sql`now()` })
        .where(and(eq(payments.txRef, txRef), inArray(payments.status, ["pending", "expired"])))
        .returning({ id: payments.id });
      return rows.length > 0;
    },

    async updatePaymentQuote(executor: SqlExecutor, txRef: string, quote: unknown): Promise<void> {
      const dbx = executor as Database;
      await dbx
        .update(payments)
        .set({ quote, updatedAt: sql`now()` })
        .where(eq(payments.txRef, txRef));
    },

    async setCheckoutUrl(teamId: string, paymentId: string, checkoutUrl: string): Promise<boolean> {
      const shard = getShardFor(teamId);
      const rows = await shard
        .update(payments)
        .set({ checkoutUrl, updatedAt: sql`now()` })
        .where(
          and(
            eq(payments.id, paymentId),
            eq(payments.teamId, teamId),
            eq(payments.kind, "renewal"),
            eq(payments.status, "pending"),
            isNull(payments.checkoutUrl),
          ),
        )
        .returning({ id: payments.id });
      return rows.length > 0;
    },

    async getPaymentById(teamId: string, paymentId: string): Promise<PaymentRow | undefined> {
      const shard = getShardFor(teamId);
      const rows = await shard
        .select()
        .from(payments)
        .where(and(eq(payments.teamId, teamId), eq(payments.id, paymentId)))
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toPayment(row);
    },

    async getLatestRenewalPayment(teamId: string): Promise<PaymentRow | undefined> {
      const shard = getShardFor(teamId);
      const rows = await shard
        .select()
        .from(payments)
        .where(and(eq(payments.teamId, teamId), eq(payments.kind, "renewal")))
        .orderBy(desc(payments.createdAt))
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toPayment(row);
    },

    async listPendingRenewals(before: Date, limit: number): Promise<PaymentRow[]> {
      const rows: PaymentRow[] = [];
      for (const shard of getAllShards()) {
        const found = await shard
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.kind, "renewal"),
              eq(payments.status, "pending"),
              lte(payments.updatedAt, before),
            ),
          )
          .orderBy(payments.updatedAt)
          .limit(limit);
        rows.push(...found.map(toPayment));
        if (rows.length >= limit) break;
      }
      return rows.slice(0, limit);
    },

    async listRenewalsNeedingCheckout(before: Date, limit: number): Promise<PaymentRow[]> {
      const rows: PaymentRow[] = [];
      for (const shard of getAllShards()) {
        const found = await shard
          .select()
          .from(payments)
          .where(
            and(
              eq(payments.kind, "renewal"),
              eq(payments.status, "pending"),
              isNull(payments.checkoutUrl),
              lte(payments.updatedAt, before),
            ),
          )
          .orderBy(payments.updatedAt)
          .limit(limit);
        rows.push(...found.map(toPayment));
        if (rows.length >= limit) break;
      }
      return rows.slice(0, limit);
    },

    async getLatestPayment(teamId: string): Promise<PaymentRow | undefined> {
      const shard = getShardFor(teamId);
      const rows = await shard
        .select()
        .from(payments)
        .where(eq(payments.teamId, teamId))
        .orderBy(desc(payments.createdAt))
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toPayment(row);
    },

    async getPaymentByTxRef(executor: SqlExecutor, txRef: string): Promise<PaymentRow | undefined> {
      const dbx = executor as Database;
      const rows = await dbx.select().from(payments).where(eq(payments.txRef, txRef)).limit(1);
      const row = rows[0];
      return row === undefined ? undefined : toPayment(row);
    },
  };
}

export type PaymentRepository = ReturnType<typeof createPaymentRepository>;

export function createWebhookRepository() {
  return {
    async insertEvent(row: Omit<WebhookEventRow, "receivedAt" | "processedAt" | "attempts"> & { attempts?: number }): Promise<"inserted" | "duplicate"> {
      const shard = getShardFor(row.teamId);
      try {
        await shard.insert(webhookEvents).values({
          eventKey: row.eventKey,
          teamId: row.teamId,
          provider: row.provider,
          txRef: row.txRef,
          payload: row.payload,
          attempts: row.attempts ?? 0,
        });
        return "inserted";
      } catch (error) {
        if (isUniqueViolation(error)) return "duplicate";
        throw error;
      }
    },
  };
}

export async function getWebhookEventOnShard(
  executor: SqlExecutor,
  eventKey: string,
): Promise<WebhookEventRow | undefined> {
  const dbx = executor as Database;
  const rows = await dbx.select().from(webhookEvents).where(eq(webhookEvents.eventKey, eventKey)).limit(1);
  const row = rows[0];
  return row === undefined ? undefined : toWebhook(row);
}

export async function markWebhookProcessed(executor: SqlExecutor, eventKey: string): Promise<void> {
  const dbx = executor as Database;
  await dbx.update(webhookEvents).set({ processedAt: sql`now()` }).where(eq(webhookEvents.eventKey, eventKey));
}

export async function incrementWebhookAttempts(executor: SqlExecutor, eventKey: string): Promise<void> {
  const dbx = executor as Database;
  await dbx
    .update(webhookEvents)
    .set({ attempts: sql`${webhookEvents.attempts} + 1` })
    .where(eq(webhookEvents.eventKey, eventKey));
}

export async function listUnprocessedOnShard(
  executor: SqlExecutor,
  limit: number,
): Promise<WebhookEventRow[]> {
  const dbx = executor as Database;
  const rows = await dbx
    .select()
    .from(webhookEvents)
    .where(isNull(webhookEvents.processedAt))
    .orderBy(webhookEvents.receivedAt)
    .limit(limit);
  return rows.map(toWebhook);
}
