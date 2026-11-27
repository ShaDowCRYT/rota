import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { applyVerifiedPayment } from "./paymentApply.js";
import type { PaymentRow } from "./paymentRepository.js";
import type { SubscriptionRow } from "./types.js";
import type { VerifiedTransaction } from "../../providers/payments/types.js";
import { FakeBillingRepository, FakePaymentRepository } from "../../test/fakeBilling.js";
import { unusedActivityService } from "../../test/helpers.js";
import type { SqlExecutor } from "../../db/types.js";

const now = new Date("2026-02-01T00:00:00.000Z");

function makePayment(teamId: string, ownerId: string, overrides: Partial<PaymentRow> = {}): PaymentRow {
  const paymentId = randomUUID();
  return {
    id: paymentId,
    teamId,
    txRef: `rota.${teamId}.${paymentId}`,
    kind: "change",
    amountCents: 2000,
    currency: "USD",
    planId: "team",
    seats: 15,
    quote: { creditCents: 0, costCents: 2000 },
    status: "pending",
    providerTxId: null,
    checkoutUrl: null,
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSubscription(teamId: string, overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    teamId,
    planId: "starter",
    seats: 5,
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-01-31T00:00:00.000Z"),
    status: "active",
    pendingPlanId: null,
    pendingSeats: null,
    graceEndsAt: null,
    lastNotice: 0,
    updatedAt: now,
    ...overrides,
  };
}

function verified(payment: PaymentRow, overrides: Partial<VerifiedTransaction> = {}): VerifiedTransaction {
  return {
    providerTxId: randomUUID(),
    txRef: payment.txRef,
    status: "successful",
    amountCents: payment.amountCents,
    currency: payment.currency,
    ...overrides,
  };
}

function depsFor(repository: FakeBillingRepository, paymentRepository: FakePaymentRepository) {
  return {
    paymentRepository,
    repository,
    transactions: <T>(_teamId: string, work: (executor: SqlExecutor) => T | Promise<T>): Promise<T> =>
      Promise.resolve(work({} as SqlExecutor)),
    activity: unusedActivityService,
    now: () => now,
  };
}

describe("applyVerifiedPayment", () => {
  it("records a duplicate initial payment without applying value twice", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const payment = makePayment(teamId, ownerId, { kind: "initial" });
    const repository = new FakeBillingRepository();
    const paymentRepository = new FakePaymentRepository();
    paymentRepository.payments.push(payment);
    repository.subscriptions.set(teamId, makeSubscription(teamId));

    const result = await applyVerifiedPayment(depsFor(repository, paymentRepository), {
      teamId,
      txRef: payment.txRef,
      verified: verified(payment),
    });

    expect(result).toBe("duplicate");
    expect(repository.ledger).toHaveLength(1);
    expect(repository.ledger[0]?.type).toBe("adjustment");
    expect(repository.ledger[0]?.amountCents).toBe(0);
  });

  it("accepts overpayment at the quoted amount and flags it for review", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const payment = makePayment(teamId, ownerId);
    const repository = new FakeBillingRepository();
    const paymentRepository = new FakePaymentRepository();
    paymentRepository.payments.push(payment);

    const result = await applyVerifiedPayment(depsFor(repository, paymentRepository), {
      teamId,
      txRef: payment.txRef,
      verified: verified(payment, { amountCents: 2500 }),
    });

    expect(result).toBe("applied");
    expect(repository.ledger).toHaveLength(1);
    expect(repository.ledger[0]?.amountCents).toBe(2000);
    expect(payment.quote).toMatchObject({ needsReview: true, providerAmountCents: 2500 });
  });

  it("activates a renewed subscription for the quoted period", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const periodStart = new Date("2026-02-01T00:00:00.000Z");
    const periodEnd = new Date("2026-03-03T00:00:00.000Z");
    const payment = makePayment(teamId, ownerId, {
      kind: "renewal",
      amountCents: 5000,
      planId: "team",
      seats: 15,
      quote: { planId: "team", periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
    });
    const repository = new FakeBillingRepository();
    const paymentRepository = new FakePaymentRepository();
    paymentRepository.payments.push(payment);
    repository.subscriptions.set(
      teamId,
      makeSubscription(teamId, {
        planId: "team",
        seats: 15,
        status: "past_due",
        periodEnd: new Date("2026-01-31T00:00:00.000Z"),
        graceEndsAt: new Date("2026-02-05T00:00:00.000Z"),
        lastNotice: 3,
      }),
    );

    const result = await applyVerifiedPayment(depsFor(repository, paymentRepository), {
      teamId,
      txRef: payment.txRef,
      verified: verified(payment),
    });

    expect(result).toBe("applied");
    expect(repository.ledger[0]).toMatchObject({ type: "renewal", amountCents: 5000 });
    expect(repository.subscriptions.get(teamId)).toMatchObject({
      status: "active",
      graceEndsAt: null,
      lastNotice: 0,
      periodStart,
      periodEnd,
    });
  });

  it("marks a lower payment as failed without writing ledger rows", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const payment = makePayment(teamId, ownerId);
    const repository = new FakeBillingRepository();
    const paymentRepository = new FakePaymentRepository();
    paymentRepository.payments.push(payment);

    const result = await applyVerifiedPayment(depsFor(repository, paymentRepository), {
      teamId,
      txRef: payment.txRef,
      verified: verified(payment, { amountCents: 1999 }),
    });

    expect(result).toBe("mismatch");
    expect(payment.status).toBe("failed");
    expect(repository.ledger).toHaveLength(0);
  });
});
