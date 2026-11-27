import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import { Redis } from "ioredis";

import { getErrorMessage } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const BILLING_WEBHOOK_QUEUE = "billing-webhooks";

export interface BillingWebhookJobData {
  eventKey: string;
  teamId: string;
  txRef: string;
}

export interface BillingQueueRuntime {
  queue: Queue<BillingWebhookJobData>;
  connection: Redis;
  close: () => Promise<void>;
}

export interface BillingWorkerRuntime {
  worker: Worker<BillingWebhookJobData>;
  connection: Redis;
  close: () => Promise<void>;
}

export interface BillingQueueSettings {
  redisUrl: string;
}

const defaultJobOptions: JobsOptions = {
  attempts: 8,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: 100,
  removeOnFail: false,
};

function createBullConnection(redisUrl: string): Redis {
  // BullMQ requires maxRetriesPerRequest=null for blocking worker commands.
  // Keep this connection separate from the app Redis client (maxRetriesPerRequest=2).
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function createBillingQueue(settings: BillingQueueSettings): BillingQueueRuntime {
  const connection = createBullConnection(settings.redisUrl);
  const queue = new Queue<BillingWebhookJobData>(BILLING_WEBHOOK_QUEUE, {
    connection,
    defaultJobOptions,
  });
  return {
    queue,
    connection,
    close: async () => {
      await queue.close();
      connection.disconnect();
    },
  };
}

export function createBillingWorker(
  settings: BillingQueueSettings,
  processor: Processor<BillingWebhookJobData>,
): BillingWorkerRuntime {
  const connection = createBullConnection(settings.redisUrl);
  const worker = new Worker<BillingWebhookJobData>(BILLING_WEBHOOK_QUEUE, processor, {
    connection,
    concurrency: 2,
    lockDuration: 60_000,
    // Upstash free tier has command budget; slower polling reduces idle commands.
    drainDelay: 30_000,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  });

  worker.on("failed", (_job, error) => {
    logger.warn("billing webhook job failed", {
      error: getErrorMessage(error),
    });
  });


  worker.on("error", (error) => {
    logger.error("billing worker error", { error: getErrorMessage(error) });
  });

  return {
    worker,
    connection,
    close: async () => {
      await worker.close();
      connection.disconnect();
    },
  };
}
