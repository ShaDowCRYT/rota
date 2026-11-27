import type { Processor } from "bullmq";

import type { Database } from "../../db/client.js";
import type { TransactionRunner } from "../../db/types.js";
import { getErrorMessage } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import type { ActivityService } from "../activity/types.js";
import { type PlanId } from "./proration.js";
import type { BillingRepository } from "./types.js";
import {
  getWebhookEventOnShard,
  incrementWebhookAttempts,
  markWebhookProcessed,
  type PaymentRow,
} from "./paymentRepository.js";
import type { PaymentProvider } from "../../providers/payments/types.js";
import { payments } from "../../db/schema/shard.js";
import { and, eq, inArray, sql } from "drizzle-orm";

export interface BillingWorkerDeps {
  provider: PaymentProvider;
  repository: BillingRepository;
  transactions: TransactionRunner;
  activity: ActivityService;
  currency: string;
  now: () => Date;
}

function parseTxRef(txRef: string): { teamId: string } | undefined {
  const parts = txRef.split(".");
  if (parts.length !== 3 || parts[0] !== "rota") return undefined;
  return { teamId: parts[1] };
}

export function createBillingWebhookWorker(deps: BillingWorkerDeps): Processor<{ eventKey: string; teamId: string; txRef: string }> {
  return async (job) => {
    const { eventKey, teamId, txRef } = job.data;
    const parsed = parseTxRef(txRef);
    const shardTeamId = parsed?.teamId ?? teamId;

    await deps.transactions(shardTeamId, async (executor) => {
      await incrementWebhookAttempts(executor, eventKey);
    }).catch(() => undefined);

    const event = await deps.transactions(shardTeamId, async (executor) =>
      getWebhookEventOnShard(executor, eventKey),
    );
    if (event === undefined || event.processedAt !== null) {
      return;
    }

    const payload = event.payload as { data?: { id?: string | number } };
    const providerTxId = String(payload?.data?.id ?? "");
    if (!providerTxId) {
      await deps.transactions(shardTeamId, async (executor) => {
        await markWebhookProcessed(executor, eventKey);
      });
      return;
    }

    let verified;
    try {
      verified = await deps.provider.verifyTransaction(providerTxId);
    } catch (error) {
      logger.warn("billing webhook verification failed; will retry", {
        eventKeyHash: eventKey.slice(0, 24),
        error: getErrorMessage(error),
      });
      throw error;
    }

    const payment = await deps.transactions(shardTeamId, async (executor) => {
      const dbx = executor as Database;
      const rows = await dbx.select().from(payments).where(eq(payments.txRef, txRef)).limit(1);
      return rows[0] as PaymentRow | undefined;
    });

    if (payment === undefined) {
      await deps.transactions(shardTeamId, async (executor) => {
        await markWebhookProcessed(executor, eventKey);
      });
      return;
    }

    const ok =
      verified.status === "successful" &&
      verified.txRef === txRef &&
      verified.amountCents === payment.amountCents &&
      verified.currency.toUpperCase() === payment.currency.toUpperCase();

    if (!ok) {
      await deps.transactions(shardTeamId, async (executor) => {
        const dbx = executor as Database;
        await dbx
          .update(payments)
          .set({ status: "failed", providerTxId: verified.providerTxId, updatedAt: sql`now()` })
          .where(and(eq(payments.txRef, txRef), inArray(payments.status, ["pending", "expired"])));
        await markWebhookProcessed(executor, eventKey);
      });
      await deps.transactions(shardTeamId, async (executor) => { await deps.activity.record(executor, { teamId: shardTeamId, type: "billing_payment_failed", actorId: payment.createdBy, payload: { planId: payment.planId, seats: payment.seats } }); }).catch(() => undefined);
      logger.warn("billing webhook verification mismatch", { eventKeyHash: eventKey.slice(0, 24) });
      return;
    }

    await deps.transactions(shardTeamId, async (executor) => {
      const dbx = executor as Database;
      const claimed = await dbx
        .update(payments)
        .set({ status: "succeeded", providerTxId: verified.providerTxId, updatedAt: sql`now()` })
        .where(and(eq(payments.txRef, txRef), inArray(payments.status, ["pending", "expired"])))
        .returning({ id: payments.id });
      if (claimed.length === 0) {
        await markWebhookProcessed(executor, eventKey);
        return;
      }

      const now = deps.now();
      const periodStart = now;
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (payment.kind === "initial") {
        await deps.repository.appendLedgerEntry(executor, {
          teamId: shardTeamId,
          type: "charge",
          amountCents: payment.amountCents,
          currency: payment.currency,
          ref: txRef,
          planId: payment.planId as PlanId,
          seats: payment.seats,
          periodStart,
          periodEnd,
          idempotencyRef: txRef,
        });
        await deps.repository.upsertSubscription(executor, {
          teamId: shardTeamId,
          planId: payment.planId as PlanId,
          seats: payment.seats,
          periodStart,
          periodEnd,
          status: "active",
          pendingPlanId: null,
          pendingSeats: null,
        });
      } else {
        const quote = payment.quote as { creditCents?: number; costCents?: number } | null;
        const credit = Number(quote?.creditCents ?? 0);
        const cost = Number(quote?.costCents ?? payment.amountCents);
        if (credit > 0) {
          await deps.repository.appendLedgerEntry(executor, {
            teamId: shardTeamId,
            type: "credit",
            amountCents: -credit,
            currency: payment.currency,
            ref: txRef,
            planId: payment.planId as PlanId,
            seats: payment.seats,
            periodStart: null,
            periodEnd: null,
            idempotencyRef: `${txRef}:credit`,
          });
        }
        await deps.repository.appendLedgerEntry(executor, {
          teamId: shardTeamId,
          type: "charge",
          amountCents: cost,
          currency: payment.currency,
          ref: txRef,
          planId: payment.planId as PlanId,
          seats: payment.seats,
          periodStart: null,
          periodEnd: null,
          idempotencyRef: `${txRef}:charge`,
        });
        const current = await deps.repository.getSubscription(shardTeamId, executor);
        await deps.repository.upsertSubscription(executor, {
          teamId: shardTeamId,
          planId: payment.planId as PlanId,
          seats: payment.seats,
          periodStart: current?.periodStart ?? now,
          periodEnd: current?.periodEnd ?? periodEnd,
          status: "active",
          pendingPlanId: null,
          pendingSeats: null,
        });
      }

      await deps.activity.record(executor, {
        teamId: shardTeamId,
        type: "billing_payment_succeeded",
        actorId: payment.createdBy,
        payload: { planId: payment.planId, seats: payment.seats },
      });
      await markWebhookProcessed(executor, eventKey);
    });
  };
}
