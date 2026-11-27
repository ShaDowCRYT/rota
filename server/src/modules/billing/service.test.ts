import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createBillingService } from "./service.js";
import type { PaymentRow } from "./paymentRepository.js";
import type { SubscriptionRow } from "./types.js";
import type { PaymentProvider } from "../../providers/payments/types.js";
import { FakeBillingRepository, FakeIdempotencyRepository, FakePaymentRepository } from "../../test/fakeBilling.js";
import { fakeExecutor, testTransactionRunner } from "../../test/helpers.js";

describe("billing service seat limits", () => {
  it("treats missing subscription as Starter with 5 seats", async () => {
    const repo = new FakeBillingRepository();
    repo.seatsUsedByTeam.set("team-1", 4);
    const service = createBillingService({
      repository: repo,
      paymentRepository: new FakePaymentRepository(),
      idempotencyRepository: new FakeIdempotencyRepository(),
      globalDb: fakeExecutor as never,
      paymentsEnabled: false,
      currency: "USD",
      transactions: testTransactionRunner,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const status = await service.getStatus("team-1");
    expect(status.status).toBe("none");
    expect(status.planId).toBe("starter");
    expect(status.seats).toBe(5);
    await expect(service.assertSeatAvailable("team-1")).resolves.toBeUndefined();

    repo.seatsUsedByTeam.set("team-1", 5);
    await expect(service.assertSeatAvailable("team-1")).rejects.toMatchObject({
      status: 409,
      message: "Seat limit reached for this plan",
    });
  });
});

function subscriptionFor(teamId: string): SubscriptionRow {
  return {
    teamId,
    planId: "team",
    seats: 15,
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-01-31T00:00:00.000Z"),
    status: "past_due",
    pendingPlanId: null,
    pendingSeats: null,
    graceEndsAt: new Date("2026-02-05T00:00:00.000Z"),
    lastNotice: 1,
    updatedAt: new Date("2026-01-31T00:00:00.000Z"),
  };
}

function renewalPaymentFor(teamId: string): PaymentRow {
  const paymentId = randomUUID();
  return {
    id: paymentId,
    teamId,
    txRef: `rota.${teamId}.${paymentId}`,
    kind: "renewal",
    amountCents: 5000,
    currency: "USD",
    planId: "team",
    seats: 15,
    quote: { planId: "team" },
    status: "pending",
    providerTxId: null,
    checkoutUrl: "https://payments.test/renew",
    createdBy: randomUUID(),
    createdAt: new Date("2026-01-31T00:00:00.000Z"),
    updatedAt: new Date("2026-01-31T00:00:00.000Z"),
  };
}

function providerWithCheckout(): PaymentProvider {
  return {
    verifyWebhookAuth() {
      return false;
    },
    async createCheckout() {
      return { checkoutUrl: "https://payments.test/new-renew" };
    },
    async verifyTransaction() {
      throw new Error("unused");
    },
    async verifyByReference() {
      throw new Error("unused");
    },
    parseWebhook() {
      return undefined;
    },
    describeIgnoredWebhook() {
      return { topLevelKeys: [], dataKeys: [] };
    },
  };
}

describe("billing service renewal visibility", () => {
  it("shows renewal details only to owners", async () => {
    const teamId = "team-1";
    const repository = new FakeBillingRepository();
    const paymentRepository = new FakePaymentRepository();
    repository.subscriptions.set(teamId, subscriptionFor(teamId));
    paymentRepository.payments.push(renewalPaymentFor(teamId));
    const service = createBillingService({
      repository,
      paymentRepository,
      idempotencyRepository: new FakeIdempotencyRepository(),
      globalDb: fakeExecutor as never,
      paymentsEnabled: false,
      currency: "USD",
      transactions: testTransactionRunner,
      now: () => new Date("2026-01-31T00:00:00.000Z"),
    });

    const owner = await service.getStatus(teamId, "owner");
    const staff = await service.getStatus(teamId, "staff");

    expect(owner.amountDueCents).toBe(5000);
    expect(owner.renewalCheckoutUrl).toBe("https://payments.test/renew");
    expect(staff.amountDueCents).toBeNull();
    expect(staff.renewalCheckoutUrl).toBeNull();
  });

  it("blocks writes only when restricted", async () => {
    const teamId = "team-1";
    const repository = new FakeBillingRepository();
    repository.subscriptions.set(teamId, subscriptionFor(teamId));
    const service = createBillingService({
      repository,
      paymentRepository: new FakePaymentRepository(),
      idempotencyRepository: new FakeIdempotencyRepository(),
      globalDb: fakeExecutor as never,
      paymentsEnabled: false,
      currency: "USD",
      transactions: testTransactionRunner,
      now: () => new Date("2026-01-31T00:00:00.000Z"),
    });

    await expect(service.assertTeamWritable(teamId)).resolves.toBeUndefined();
    repository.subscriptions.set(teamId, { ...subscriptionFor(teamId), status: "restricted" });
    await expect(service.assertTeamWritable(teamId)).rejects.toMatchObject({
      status: 402,
      message: "This team's subscription needs attention",
    });
  });

  it("creates one renewal checkout URL", async () => {
    const teamId = "team-1";
    const repository = new FakeBillingRepository();
    const paymentRepository = new FakePaymentRepository();
    const payment = renewalPaymentFor(teamId);
    payment.checkoutUrl = null;
    paymentRepository.payments.push(payment);
    const service = createBillingService({
      repository,
      paymentRepository,
      idempotencyRepository: new FakeIdempotencyRepository(),
      globalDb: fakeExecutor as never,
      provider: providerWithCheckout(),
      paymentsEnabled: true,
      currency: "USD",
      publicApiUrl: "https://rota.test",
      transactions: testTransactionRunner,
      now: () => new Date("2026-01-31T00:00:00.000Z"),
    });

    const first = await service.createRenewalCheckout(teamId, payment.id, "owner@example.test");
    const second = await service.createRenewalCheckout(teamId, payment.id, "owner@example.test");

    expect(first.checkoutUrl).toBe("https://payments.test/new-renew");
    expect(second).toEqual(first);
    expect(payment.checkoutUrl).toBe("https://payments.test/new-renew");
  });
});
