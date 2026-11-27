import { randomUUID } from "node:crypto";

import type { BillingWebhookJobData, BillingQueueRuntime } from "./billingQueue.js";

export interface BillingQueue {
  enqueueWebhook(data: BillingWebhookJobData): Promise<void>;
  close(): Promise<void>;
}

export function createBillingQueueAdapter(runtime: BillingQueueRuntime): BillingQueue {
  return {
    async enqueueWebhook(data) {
      await runtime.queue.add("billing-webhook", data, { jobId: data.eventKey });
    },
    async close() {
      await runtime.close();
    },
  };
}

export function createFakeBillingQueue(): BillingQueue & { jobs: BillingWebhookJobData[] } {
  const jobs: BillingWebhookJobData[] = [];
  return {
    jobs,
    async enqueueWebhook(data) {
      jobs.push(data);
    },
    async close() {},
  };
}

export function makeTxRef(teamId: string, paymentId = randomUUID()): string {
  return `rota.${teamId}.${paymentId}`;
}
