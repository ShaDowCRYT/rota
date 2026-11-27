import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { createBillingWebhookRouter } from "./webhook.js";
import { configureShards } from "../../db/shard.js";
import { HttpError } from "../../lib/errors.js";
import type { RateLimiter } from "../../middleware/rateLimit.js";
import type { BillingQueue } from "../../jobs/billingQueueAdapter.js";
import type { BillingWebhookJobData } from "../../jobs/billingQueue.js";
import type { PaymentProvider } from "../../providers/payments/types.js";
import { startServer } from "../../test/helpers.js";
import type { WebhookEventRow } from "./paymentRepository.js";

const webhookHash = "test-hash";

function uniqueViolation(): Error {
  return Object.assign(new Error("duplicate event"), { cause: { code: "23505" } });
}

interface FakeShardOptions {
  existing?: WebhookEventRow[];
  insertError?: Error;
}

function fakeShard(options: FakeShardOptions = {}) {
  const rows: WebhookEventRow[] = options.existing ? [...options.existing] : [];
  const inserted: unknown[] = [];

  const db = {
    insert() {
      return {
        async values(row: unknown) {
          if (options.insertError) throw options.insertError;
          const insertedRow = row as {
            eventKey: string;
            teamId: string;
            provider: string;
            txRef: string;
            payload: unknown;
          };
          inserted.push(insertedRow);
          rows.push({
            ...insertedRow,
            receivedAt: new Date("2026-01-01T00:00:00.000Z"),
            processedAt: null,
            attempts: 0,
          });
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return rows.slice(0, 1);
                },
              };
            },
          };
        },
      };
    },
  };

  return { db, inserted, rows };
}

function fakeProvider(): PaymentProvider {
  return {
    verifyWebhookAuth(headers) {
      const raw = headers["verif-hash"];
      return (Array.isArray(raw) ? raw[0] : raw) === webhookHash;
    },
    async createCheckout() {
      throw new Error("unused");
    },
    async verifyTransaction() {
      throw new Error("unused");
    },
  };
}

interface HarnessOptions extends FakeShardOptions {
  limiter?: RateLimiter;
  enqueueError?: Error;
}

function harness(options: HarnessOptions = {}) {
  const shard = fakeShard(options);
  configureShards([shard.db as never]);

  const jobs: BillingWebhookJobData[] = [];
  const queue: BillingQueue = {
    async enqueueWebhook(data) {
      if (options.enqueueError) throw options.enqueueError;
      jobs.push(data);
    },
    async close() {},
  };

  const limiter: RateLimiter = options.limiter ?? {
    async consume() {},
  };

  const app = express();
  app.use(
    "/webhooks/flutterwave",
    createBillingWebhookRouter({
      provider: fakeProvider(),
      queue,
      limiter,
    }),
  );

  return { app, jobs, inserted: shard.inserted, rows: shard.rows };
}

function webhookBody(overrides: Record<string, unknown> = {}) {
  const teamId = randomUUID();
  const paymentId = randomUUID();
  const providerTxId = randomUUID();
  return {
    teamId,
    paymentId,
    providerTxId,
    eventKey: `charge.completed:${providerTxId}:successful`,
    body: JSON.stringify({
      event: "charge.completed",
      data: {
        id: providerTxId,
        tx_ref: `rota.${teamId}.${paymentId}`,
        status: "successful",
        amount: "20.00",
        currency: "USD",
        ...overrides,
      },
    }),
  };
}

async function postWebhook(baseUrl: string, body: string, hash = webhookHash) {
  return fetch(`${baseUrl}/webhooks/flutterwave`, {
    method: "POST",
    headers: { "content-type": "application/json", "verif-hash": hash },
    body,
  });
}

describe("billing webhook route", () => {
  let server: Server | undefined;

  async function start(harnessOptions: HarnessOptions = {}) {
    const created = harness(harnessOptions);
    const started = await startServer(created.app);
    server = started.server;
    return { ...created, ...started };
  }

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("rejects a bad hash before storing or queueing", async () => {
    const started = await start();
    const message = webhookBody();

    const response = await postWebhook(started.baseUrl, message.body, "wrong-hash");

    expect(response.status).toBe(401);
    expect(started.inserted).toHaveLength(0);
    expect(started.jobs).toHaveLength(0);
  });

  it("rejects invalid JSON after auth", async () => {
    const started = await start();

    const response = await postWebhook(started.baseUrl, "{not-json");

    expect(response.status).toBe(400);
    expect(started.inserted).toHaveLength(0);
    expect(started.jobs).toHaveLength(0);
  });

  it("ignores events other than charge.completed", async () => {
    const started = await start();
    const payload = JSON.parse(webhookBody().body) as { event: string };
    payload.event = "transfer.completed";

    const response = await postWebhook(started.baseUrl, JSON.stringify(payload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(started.inserted).toHaveLength(0);
    expect(started.jobs).toHaveLength(0);
  });

  it("ignores a charge without a tx_ref", async () => {
    const started = await start();
    const payload = JSON.parse(webhookBody().body) as { data: Record<string, unknown> };
    delete payload.data.tx_ref;

    const response = await postWebhook(started.baseUrl, JSON.stringify(payload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(started.inserted).toHaveLength(0);
    expect(started.jobs).toHaveLength(0);
  });

  it("ignores a tx_ref with an invalid shape", async () => {
    const started = await start();
    const message = webhookBody({ tx_ref: "not-a-rota-reference" });

    const response = await postWebhook(started.baseUrl, message.body);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ignored" });
    expect(started.inserted).toHaveLength(0);
    expect(started.jobs).toHaveLength(0);
  });

  it("stores a verified event, queues one job, and returns fast", async () => {
    const started = await start();
    const message = webhookBody();

    const response = await postWebhook(started.baseUrl, message.body);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "queued" });
    expect(started.inserted).toHaveLength(1);
    expect(started.jobs).toEqual([
      { eventKey: message.eventKey, teamId: message.teamId, txRef: `rota.${message.teamId}.${message.paymentId}` },
    ]);
  });

  it("re-enqueues a duplicate that is not processed", async () => {
    const message = webhookBody();
    const started = await start({ insertError: uniqueViolation() });

    const response = await postWebhook(started.baseUrl, message.body);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "duplicate" });
    expect(started.jobs).toEqual([
      { eventKey: message.eventKey, teamId: message.teamId, txRef: `rota.${message.teamId}.${message.paymentId}` },
    ]);
  });

  it("does not re-enqueue a duplicate that is already processed", async () => {
    const message = webhookBody();
    const existing: WebhookEventRow = {
      eventKey: message.eventKey,
      teamId: message.teamId,
      provider: "flutterwave",
      txRef: `rota.${message.teamId}.${message.paymentId}`,
      payload: {},
      receivedAt: new Date("2026-01-01T00:00:00.000Z"),
      processedAt: new Date("2026-01-01T00:00:01.000Z"),
      attempts: 1,
    };
    const started = await start({ existing: [existing], insertError: uniqueViolation() });

    const response = await postWebhook(started.baseUrl, message.body);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "duplicate" });
    expect(started.jobs).toHaveLength(0);
  });

  it("returns 500 when the event cannot be stored", async () => {
    const started = await start({ insertError: new Error("store unavailable") });

    const response = await postWebhook(started.baseUrl, webhookBody().body);

    expect(response.status).toBe(500);
    expect(started.jobs).toHaveLength(0);
  });

  it("returns 500 when the queue cannot accept the job", async () => {
    const started = await start({ enqueueError: new Error("queue unavailable") });

    const response = await postWebhook(started.baseUrl, webhookBody().body);

    expect(response.status).toBe(500);
  });

  it("fails open when the webhook rate limiter is unavailable", async () => {
    const limiter: RateLimiter = {
      async consume() {
        throw new HttpError(503, "Service unavailable");
      },
    };
    const started = await start({ limiter });
    const message = webhookBody();

    const response = await postWebhook(started.baseUrl, message.body);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "queued" });
    expect(started.jobs).toHaveLength(1);
  });

  it("still returns 429 when the webhook rate limit is exceeded", async () => {
    const limiter: RateLimiter = {
      async consume() {
        throw new HttpError(429, "Too many requests");
      },
    };
    const started = await start({ limiter });

    const response = await postWebhook(started.baseUrl, webhookBody().body);

    expect(response.status).toBe(429);
    expect(started.jobs).toHaveLength(0);
  });
});
