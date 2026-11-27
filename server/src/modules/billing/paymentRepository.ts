import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../../db/client.js";
import { payments, webhookEvents } from "../../db/schema/shard.js";
import { getShardFor } from "../../db/shard.js";
import type { SqlExecutor } from "../../db/types.js";
import { isUniqueViolation } from "../../lib/errors.js";

export interface PaymentRow {
  id: string;
  teamId: string;
  txRef: string;
  kind: "initial" | "change";
  amountCents: number;
  currency: string;
  planId: string;
  seats: number;
  quote: unknown | null;
  status: "pending" | "succeeded" | "failed" | "expired";
  providerTxId: string | null;
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
      row: Omit<PaymentRow, "createdAt" | "updatedAt" | "providerTxId" | "status"> & {
        status?: PaymentRow["status"];
        providerTxId?: string | null;
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
