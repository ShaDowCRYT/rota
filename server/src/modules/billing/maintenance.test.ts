import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { runBillingMaintenance } from "./maintenance.js";
import type { PaymentRow } from "./paymentRepository.js";
import type { SubscriptionRow } from "./types.js";
import type { PaymentProvider, VerifiedTransaction } from "../../providers/payments/types.js";
import type { EmailSender } from "../../providers/email.js";
import type { ActivityService } from "../activity/types.js";
import type { SqlExecutor } from "../../db/types.js";
import { FakeBillingRepository, FakePaymentRepository } from "../../test/fakeBilling.js";
import { unusedActivityService } from "../../test/helpers.js";

function providerFor(verified: VerifiedTransaction): PaymentProvider {
  return {
    verifyWebhookAuth() {
      return false;
    },
    async createCheckout() {
      throw new Error("unused");
    },
    async verifyTransaction() {
      throw new Error("unused");
    },
    async verifyByReference() {
      return verified;
    },
    parseWebhook() {
      return undefined;
    },
    describeIgnoredWebhook() {
      return { topLevelKeys: [], dataKeys: [] };
    },
  };
}

function emailFor(messages: { to: string; subject: string; text: string }[]): EmailSender {
  return {
    async send(message) {
      messages.push(message);
    },
  };
}

function subscriptionFor(teamId: string, periodEnd: Date, overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    teamId,
    planId: "starter",
    seats: 5,
    periodStart: new Date("2025-12-02T00:00:00.000Z"),
    periodEnd,
    status: "active",
    pendingPlanId: null,
    pendingSeats: null,
    graceEndsAt: null,
    lastNotice: 0,
    updatedAt: periodEnd,
    ...overrides,
  };
}

function depsFor(
  repository: FakeBillingRepository,
  paymentRepository: FakePaymentRepository,
  provider: PaymentProvider,
  now: Date,
  email: EmailSender = emailFor([]),
  activity: ActivityService = unusedActivityService,
) {
  return {
    repository,
    paymentRepository,
    transactions: <T>(_teamId: string, work: (executor: SqlExecutor) => T | Promise<T>): Promise<T> =>
      Promise.resolve(work({} as SqlExecutor)),
    provider,
    email,
    activity,
    currency: "USD",
    ensureRenewalCheckout: async () => ({
      checkoutUrl: "https://payments.test/checkout",
      paymentId: randomUUID(),
      amountCents: 2000,
      currency: "USD",
    }),
    now: () => now,
  };
}

describe("billing maintenance", () => {
  it("creates one renewal payment and one due notice when a period ends", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const dueAt = new Date("2026-01-01T00:00:00.000Z");
    const repository = new FakeBillingRepository();
    const paymentRepository = new FakePaymentRepository();
    const messages: { to: string; subject: string; text: string }[] = [];
    repository.subscriptions.set(teamId, subscriptionFor(teamId, dueAt));
    repository.ownerIdsByTeam.set(teamId, ownerId);
    repository.emailsByUser.set(ownerId, "owner@example.test");

    const first = await runBillingMaintenance(
      depsFor(repository, paymentRepository, providerFor({} as VerifiedTransaction), dueAt, emailFor(messages)),
    );
    const second = await runBillingMaintenance(
      depsFor(repository, paymentRepository, providerFor({} as VerifiedTransaction), dueAt, emailFor(messages)),
    );

    expect(first.renewalPaymentsCreated).toBe(1);
    expect(first.noticesSent).toBe(1);
    expect(second.renewalPaymentsCreated).toBe(0);
    expect(second.noticesSent).toBe(0);
    expect(paymentRepository.payments).toHaveLength(1);
    expect(paymentRepository.payments[0]).toMatchObject({
      kind: "renewal",
      amountCents: 2000,
      status: "pending",
    });
    expect(repository.subscriptions.get(teamId)).toMatchObject({ status: "past_due", lastNotice: 1 });
    expect(messages).toHaveLength(1);
  });

  it("sends day 3 and day 5 notices then restricts access", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const dueAt = new Date("2026-01-01T00:00:00.000Z");
    const events: string[] = [];
    const activity: ActivityService = {
      async list() {
        return { items: [], nextCursor: null };
      },
      async record(_executor, event) {
        events.push(event.type);
      },
    };
    const repository = new FakeBillingRepository();
    const paymentRepository = new FakePaymentRepository();
    repository.subscriptions.set(
      teamId,
      subscriptionFor(teamId, dueAt, {
        status: "past_due",
        graceEndsAt: new Date("2026-01-06T00:00:00.000Z"),
        lastNotice: 1,
      }),
    );
    repository.ownerIdsByTeam.set(teamId, ownerId);
    repository.emailsByUser.set(ownerId, "owner@example.test");

    await runBillingMaintenance(
      depsFor(
        repository,
        paymentRepository,
        providerFor({} as VerifiedTransaction),
        new Date("2026-01-04T00:00:00.000Z"),
        emailFor([]),
        activity,
      ),
    );
    expect(repository.subscriptions.get(teamId)).toMatchObject({ status: "past_due", lastNotice: 2 });
    expect(events).toContain("billing_renewal_reminder");

    await runBillingMaintenance(
      depsFor(
        repository,
        paymentRepository,
        providerFor({} as VerifiedTransaction),
        new Date("2026-01-06T00:00:00.000Z"),
        emailFor([]),
        activity,
      ),
    );
    expect(repository.subscriptions.get(teamId)).toMatchObject({ status: "restricted", lastNotice: 3 });
    expect(events).toContain("billing_renewal_final_notice");
    expect(events).toContain("billing_access_restricted");
  });

  it("reconciles an old pending renewal by its tx_ref", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const now = new Date("2026-01-20T00:00:00.000Z");
    const periodStart = new Date("2026-01-01T00:00:00.000Z");
    const periodEnd = new Date("2026-01-31T00:00:00.000Z");
    const payment: PaymentRow = {
      id: randomUUID(),
      teamId,
      txRef: `rota.${teamId}.${randomUUID()}`,
      kind: "renewal",
      amountCents: 2000,
      currency: "USD",
      planId: "starter",
      seats: 5,
      quote: {
        planId: "starter",
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      },
      status: "pending",
      providerTxId: null,
      checkoutUrl: "https://payments.test/checkout",
      createdBy: ownerId,
      createdAt: new Date("2026-01-19T00:00:00.000Z"),
      updatedAt: new Date("2026-01-19T00:00:00.000Z"),
    };
    const repository = new FakeBillingRepository();
    const paymentRepository = new FakePaymentRepository();
    paymentRepository.payments.push(payment);
    repository.subscriptions.set(
      teamId,
      subscriptionFor(teamId, periodStart, {
        status: "past_due",
        graceEndsAt: new Date("2026-01-06T00:00:00.000Z"),
        lastNotice: 3,
      }),
    );

    const result = await runBillingMaintenance(
      depsFor(
        repository,
        paymentRepository,
        providerFor({
          providerTxId: randomUUID(),
          txRef: payment.txRef,
          status: "successful",
          amountCents: 2000,
          currency: "USD",
        }),
        now,
      ),
    );

    expect(result.paymentsReconciled).toBe(1);
    expect(payment.status).toBe("succeeded");
    expect(repository.ledger[0]).toMatchObject({ type: "renewal", amountCents: 2000 });
    expect(repository.subscriptions.get(teamId)).toMatchObject({
      status: "active",
      periodStart,
      periodEnd,
    });
  });
});
