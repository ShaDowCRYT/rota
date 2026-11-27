import { randomUUID } from "node:crypto";

import type {
  BillingWebhookJobData,
  BillingQueueRuntime,
  BillingMaintenanceJobData,
  BillingMaintenanceQueueRuntime,
} from "./billingQueue.js";

export interface BillingQueue {
  enqueueWebhook(data: BillingWebhookJobData): Promise<void>;
  enqueueMaintenance?(data?: BillingMaintenanceJobData): Promise<void>;
  close(): Promise<void>;
}

export interface BillingMaintenanceQueue {
  enqueueNow(reason?: string): Promise<void>;
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

export function createBillingMaintenanceQueueAdapter(
  runtime: BillingMaintenanceQueueRuntime,
): BillingMaintenanceQueue {
  return {
    async enqueueNow(reason = "manual") {
      await runtime.queue.add("billing-maintenance", { reason });
    },
    async close() {
      await runtime.close();
    },
  };
}

export function createFakeBillingQueue(): BillingQueue & {
  jobs: BillingWebhookJobData[];
  maintenanceJobs: BillingMaintenanceJobData[];
} {
  const jobs: BillingWebhookJobData[] = [];
  const maintenanceJobs: BillingMaintenanceJobData[] = [];
  return {
    jobs,
    maintenanceJobs,
    async enqueueWebhook(data) {
      jobs.push(data);
    },
    async enqueueMaintenance(data = {}) {
      maintenanceJobs.push(data);
    },
    async close() {},
  };
}

export function makeTxRef(teamId: string, paymentId = randomUUID()): string {
  return `rota.${teamId}.${paymentId}`;
}
