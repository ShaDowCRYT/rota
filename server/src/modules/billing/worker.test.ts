import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createBillingWebhookWorker } from "./worker.js";
import { reenqueueUnprocessedWebhookEvents } from "./recovery.js";
import { configureShards } from "../../db/shard.js";
import { webhookEvents } from "../../db/schema/shard.js";
import type { PaymentProvider, VerifiedTransaction } from "../../providers/payments/types.js";
import type { PaymentRow, WebhookEventRow } from "./paymentRepository.js";
import { FakeBillingRepository } from "../../test/fakeBilling.js";
import { unusedActivityService } from "../../test/helpers.js";

const now = new Date("2026-01-01T00:00:00.000Z");

function makePayment(txRef: string, teamId: string, ownerId: string): PaymentRow {
  return {
    id: randomUUID(),
    teamId,
    txRef,
    kind: "change",
    amountCents: 2000,
    currency: "USD",
    planId: "team",
    seats: 15,
    quote: { chargeCents: 2000, creditCents: 0, costCents: 2000 },
    status: "pending",
    providerTxId: null,
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
  };
}

function makeEvent(eventKey: string, teamId: string, txRef: string, providerTxId: string): WebhookEventRow {
  return {
    eventKey,
    teamId,
    provider: "flutterwave",
    txRef,
    payload: { event: "charge.completed", data: { id: providerTxId } },
    receivedAt: now,
    processedAt: null,
    attempts: 0,
  };
}

class WorkerDatabase {
  readonly events = new Map<string, WebhookEventRow>();
  payment: PaymentRow;
  currentEventKey: string;

  constructor(event: WebhookEventRow, payment: PaymentRow) {
    this.events.set(event.eventKey, event);
    this.payment = payment;
    this.currentEventKey = event.eventKey;
  }

  useEvent(eventKey: string): void {
    this.currentEventKey = eventKey;
  }

  private eventRows(): WebhookEventRow[] {
    const event = this.events.get(this.currentEventKey);
    return event === undefined ? [] : [event];
  }

  private paymentRows(): PaymentRow[] {
    return [this.payment];
  }

  asDatabase(): unknown {
    return {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => (table === webhookEvents ? this.eventRows() : this.paymentRows()),
          }),
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          if (table === webhookEvents) {
            return {
              where: async () => {
                for (const event of this.events.values()) {
                  if ("attempts" in values) event.attempts += 1;
                  if ("processedAt" in values) event.processedAt = now;
                }
              },
            };
          }

          let claimed = false;
          const apply = async () => {
            if (typeof values.status === "string") {
              claimed = this.payment.status !== "succeeded" && this.payment.status !== "failed";
              this.payment.status = values.status as PaymentRow["status"];
            }
            if ("providerTxId" in values && typeof values.providerTxId === "string") {
              this.payment.providerTxId = values.providerTxId;
            }
          };
          const pending = apply();
          const whereResult = {
            then: pending.then.bind(pending),
            returning: async () => {
              await pending;
              return claimed ? [{ id: this.payment.id }] : [];
            },
          };
          return { where: () => whereResult };
        },
      }),
    };
  }
}

interface ProviderOptions {
  verified?: VerifiedTransaction;
  failuresBeforeSuccess?: number;
}

function providerFor(txRef: string, providerTxId: string, options: ProviderOptions = {}): PaymentProvider {
  const verified: VerifiedTransaction = options.verified ?? {
    providerTxId,
    txRef,
    status: "successful",
    amountCents: 2000,
    currency: "USD",
  };
  let failuresLeft = options.failuresBeforeSuccess ?? 0;
  return {
    verifyWebhookAuth() {
      return false;
    },
    async createCheckout() {
      throw new Error("unused");
    },
    async verifyTransaction() {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("provider temporary");
      }
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

function workerWith(database: WorkerDatabase, provider: PaymentProvider, repository: FakeBillingRepository) {
  configureShards([database.asDatabase() as never]);
  return createBillingWebhookWorker({
    provider,
    repository,
    transactions: (_teamId, work) => work(database.asDatabase() as never),
    activity: unusedActivityService,
    currency: "USD",
    now: () => now,
  });
}

function job(eventKey: string, teamId: string, txRef: string) {
  return { data: { eventKey, teamId, txRef } } as never;
}

describe("billing webhook worker", () => {
  it("processes two events for the same tx_ref only once", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const paymentId = randomUUID();
    const providerTxId = randomUUID();
    const txRef = `rota.${teamId}.${paymentId}`;
    const firstKey = `charge.completed:${providerTxId}:successful:first`;
    const secondKey = `charge.completed:${providerTxId}:successful:second`;
    const payment = makePayment(txRef, teamId, ownerId);
    const database = new WorkerDatabase(makeEvent(firstKey, teamId, txRef, providerTxId), payment);
    database.events.set(secondKey, makeEvent(secondKey, teamId, txRef, providerTxId));
    const repository = new FakeBillingRepository();
    const worker = workerWith(database, providerFor(txRef, providerTxId), repository);

    database.useEvent(firstKey);
    await worker(job(firstKey, teamId, txRef));
    database.useEvent(secondKey);
    await worker(job(secondKey, teamId, txRef));

    expect(repository.ledger).toHaveLength(1);
    expect(payment.status).toBe("succeeded");
    expect(database.events.get(secondKey)?.processedAt).toEqual(now);
  });

  it("retries a provider failure without writing ledger rows", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const paymentId = randomUUID();
    const providerTxId = randomUUID();
    const txRef = `rota.${teamId}.${paymentId}`;
    const eventKey = `charge.completed:${providerTxId}:successful`;
    const payment = makePayment(txRef, teamId, ownerId);
    const database = new WorkerDatabase(makeEvent(eventKey, teamId, txRef, providerTxId), payment);
    const repository = new FakeBillingRepository();
    const worker = workerWith(
      database,
      providerFor(txRef, providerTxId, { failuresBeforeSuccess: 1 }),
      repository,
    );

    await expect(worker(job(eventKey, teamId, txRef))).rejects.toThrow("provider temporary");
    expect(repository.ledger).toHaveLength(0);
    expect(payment.status).toBe("pending");

    await worker(job(eventKey, teamId, txRef));
    expect(repository.ledger).toHaveLength(1);
    expect(payment.status).toBe("succeeded");
  });

  it("does not write ledger rows when the provider amount differs", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const paymentId = randomUUID();
    const providerTxId = randomUUID();
    const txRef = `rota.${teamId}.${paymentId}`;
    const eventKey = `charge.completed:${providerTxId}:successful`;
    const payment = makePayment(txRef, teamId, ownerId);
    const database = new WorkerDatabase(makeEvent(eventKey, teamId, txRef, providerTxId), payment);
    const repository = new FakeBillingRepository();
    const worker = workerWith(
      database,
      providerFor(txRef, providerTxId, {
        verified: {
          providerTxId,
          txRef,
          status: "successful",
          amountCents: 999,
          currency: "USD",
        },
      }),
      repository,
    );

    await worker(job(eventKey, teamId, txRef));

    expect(repository.ledger).toHaveLength(0);
    expect(payment.status).toBe("failed");
    expect(database.events.get(eventKey)?.processedAt).toEqual(now);
  });

  it("does not write ledger rows when the provider currency differs", async () => {
    const teamId = randomUUID();
    const ownerId = randomUUID();
    const paymentId = randomUUID();
    const providerTxId = randomUUID();
    const txRef = `rota.${teamId}.${paymentId}`;
    const eventKey = `charge.completed:${providerTxId}:successful`;
    const payment = makePayment(txRef, teamId, ownerId);
    const database = new WorkerDatabase(makeEvent(eventKey, teamId, txRef, providerTxId), payment);
    const repository = new FakeBillingRepository();
    const worker = workerWith(
      database,
      providerFor(txRef, providerTxId, {
        verified: {
          providerTxId,
          txRef,
          status: "successful",
          amountCents: 2000,
          currency: "EUR",
        },
      }),
      repository,
    );

    await worker(job(eventKey, teamId, txRef));

    expect(repository.ledger).toHaveLength(0);
    expect(payment.status).toBe("failed");
  });
});

describe("startup re-enqueue", () => {
  it("queues every unprocessed webhook event in received order", async () => {
    const earlier = makeEvent("event-earlier", randomUUID(), "rota.ref.earlier", "provider-earlier");
    earlier.receivedAt = new Date("2026-01-01T00:00:00.000Z");
    const later = makeEvent("event-later", randomUUID(), "rota.ref.later", "provider-later");
    later.receivedAt = new Date("2026-01-01T00:00:01.000Z");
    const processed = makeEvent("event-done", randomUUID(), "rota.ref.done", "provider-done");
    processed.processedAt = now;
    const rows = [later, earlier, processed];

    configureShards([
      {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => rows.filter((row) => row.processedAt === null),
              }),
            }),
          }),
        }),
      } as never,
    ]);

    const queued: string[] = [];
    const count = await reenqueueUnprocessedWebhookEvents(
      {
        async enqueueWebhook(data) {
          queued.push(data.eventKey);
        },
        async close() {},
      },
      10,
    );

    expect(count).toBe(2);
    expect(queued).toEqual(["event-earlier", "event-later"]);
  });
});
