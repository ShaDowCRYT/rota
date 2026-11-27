import type { TransactionRunner } from "../../db/types.js";
import type { ActivityService } from "../activity/types.js";
import type { VerifiedTransaction } from "../../providers/payments/types.js";
import type { PlanId } from "./proration.js";
import type { PaymentRepository } from "./paymentRepository.js";
import type { BillingRepository } from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ApplyPaymentResult = "applied" | "duplicate" | "mismatch" | "missing";

export interface ApplyPaymentDeps {
  paymentRepository: PaymentRepository;
  repository: BillingRepository;
  transactions: TransactionRunner;
  activity: ActivityService;
  now: () => Date;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asPlanId(value: unknown): PlanId | undefined {
  return value === "starter" || value === "team" || value === "business" ? value : undefined;
}

function asDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function quoteWithReview(quote: unknown, providerAmountCents: number): unknown {
  return { ...(asRecord(quote) ?? {}), needsReview: true, providerAmountCents };
}

export async function applyVerifiedPayment(
  deps: ApplyPaymentDeps,
  input: { teamId: string; txRef: string; verified: VerifiedTransaction },
): Promise<ApplyPaymentResult> {
  const payment = await deps.transactions(input.teamId, (executor) =>
    deps.paymentRepository.getPaymentByTxRef(executor, input.txRef),
  );
  if (payment === undefined || payment === null) return "missing";

  const amountMatches =
    input.verified.amountCents >= payment.amountCents &&
    Number.isInteger(input.verified.amountCents);
  const currencyMatches =
    input.verified.currency.toUpperCase() === payment.currency.toUpperCase();
  const verified =
    input.verified.status === "successful" &&
    input.verified.txRef === input.txRef &&
    amountMatches &&
    currencyMatches;

  if (!verified) {
    await deps.transactions(input.teamId, async (executor) => {
      await deps.paymentRepository.markPaymentFailedForVerification(
        executor,
        input.txRef,
        input.verified.providerTxId,
      );
      await deps.activity.record(executor, {
        teamId: input.teamId,
        type: "billing_payment_failed",
        actorId: payment.createdBy,
        payload: { kind: payment.kind, planId: payment.planId, seats: payment.seats },
      });
    });
    return "mismatch";
  }

  const overpaid = input.verified.amountCents > payment.amountCents;
  const planId = asPlanId(payment.planId) ?? "starter";

  return deps.transactions(input.teamId, async (executor) => {
    const claimed = await deps.paymentRepository.markPaymentSucceeded(
      executor,
      input.txRef,
      input.verified.providerTxId,
    );
    if (!claimed) return "duplicate";

    if (overpaid) {
      await deps.paymentRepository.updatePaymentQuote(
        executor,
        input.txRef,
        quoteWithReview(payment.quote, input.verified.amountCents),
      );
    }

    if (payment.kind === "initial") {
      const current = await deps.repository.getSubscription(input.teamId, executor);
      if (current !== undefined && current.status !== "none") {
        await deps.repository.appendLedgerEntry(executor, {
          teamId: input.teamId,
          type: "adjustment",
          amountCents: 0,
          currency: payment.currency,
          ref: input.txRef,
          planId,
          seats: payment.seats,
          periodStart: null,
          periodEnd: null,
          idempotencyRef: `${input.txRef}:duplicate-initial`,
        });
        await deps.activity.record(executor, {
          teamId: input.teamId,
          type: "billing_duplicate_payment",
          actorId: payment.createdBy,
          payload: { kind: payment.kind, needsReview: overpaid },
        });
        return "duplicate";
      }

      const periodStart = deps.now();
      const periodEnd = new Date(periodStart.getTime() + 30 * MS_PER_DAY);
      await deps.repository.appendLedgerEntry(executor, {
        teamId: input.teamId,
        type: "charge",
        amountCents: payment.amountCents,
        currency: payment.currency,
        ref: input.txRef,
        planId,
        seats: payment.seats,
        periodStart,
        periodEnd,
        idempotencyRef: input.txRef,
      });
      await deps.repository.upsertSubscription(executor, {
        teamId: input.teamId,
        planId,
        seats: payment.seats,
        periodStart,
        periodEnd,
        status: "active",
        pendingPlanId: null,
        pendingSeats: null,
        graceEndsAt: null,
        lastNotice: 0,
      });
    } else if (payment.kind === "change") {
      const quote = asRecord(payment.quote);
      const credit = Number(quote?.creditCents ?? 0);
      const cost = Number(quote?.costCents ?? payment.amountCents);
      if (credit > 0) {
        await deps.repository.appendLedgerEntry(executor, {
          teamId: input.teamId,
          type: "credit",
          amountCents: -credit,
          currency: payment.currency,
          ref: input.txRef,
          planId,
          seats: payment.seats,
          periodStart: null,
          periodEnd: null,
          idempotencyRef: `${input.txRef}:credit`,
        });
      }
      await deps.repository.appendLedgerEntry(executor, {
        teamId: input.teamId,
        type: "charge",
        amountCents: cost,
        currency: payment.currency,
        ref: input.txRef,
        planId,
        seats: payment.seats,
        periodStart: null,
        periodEnd: null,
        idempotencyRef: `${input.txRef}:charge`,
      });
      const current = await deps.repository.getSubscription(input.teamId, executor);
      await deps.repository.upsertSubscription(executor, {
        teamId: input.teamId,
        planId,
        seats: payment.seats,
        periodStart: current?.periodStart ?? deps.now(),
        periodEnd:
          current?.periodEnd ??
          new Date(deps.now().getTime() + 30 * MS_PER_DAY),
        status: "active",
        pendingPlanId: null,
        pendingSeats: null,
        graceEndsAt: current?.graceEndsAt ?? null,
        lastNotice: current?.lastNotice ?? 0,
      });
    } else {
      const quote = asRecord(payment.quote);
      const periodStart = asDate(quote?.periodStart) ?? deps.now();
      const periodEnd =
        asDate(quote?.periodEnd) ?? new Date(periodStart.getTime() + 30 * MS_PER_DAY);
      await deps.repository.appendLedgerEntry(executor, {
        teamId: input.teamId,
        type: "renewal",
        amountCents: payment.amountCents,
        currency: payment.currency,
        ref: input.txRef,
        planId,
        seats: payment.seats,
        periodStart,
        periodEnd,
        idempotencyRef: input.txRef,
      });
      await deps.repository.upsertSubscription(executor, {
        teamId: input.teamId,
        planId: asPlanId(quote?.planId) ?? planId,
        seats: payment.seats,
        periodStart,
        periodEnd,
        status: "active",
        pendingPlanId: null,
        pendingSeats: null,
        graceEndsAt: null,
        lastNotice: 0,
      });
    }

    await deps.activity.record(executor, {
      teamId: input.teamId,
      type: "billing_payment_succeeded",
      actorId: payment.createdBy,
      payload: {
        kind: payment.kind,
        planId: payment.planId,
        seats: payment.seats,
        needsReview: overpaid,
      },
    });
    return "applied";
  });
}
