import type { Processor } from "bullmq";

import type { TransactionRunner } from "../../db/types.js";
import { getErrorMessage } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import type { ActivityService } from "../activity/types.js";
import type { PaymentProvider } from "../../providers/payments/types.js";
import { applyVerifiedPayment } from "./paymentApply.js";
import type { PaymentRepository } from "./paymentRepository.js";
import {
  getWebhookEventOnShard,
  incrementWebhookAttempts,
  markWebhookProcessed,
} from "./paymentRepository.js";
import type { BillingRepository } from "./types.js";

export interface BillingWorkerDeps {
  provider: PaymentProvider;
  repository: BillingRepository;
  paymentRepository: PaymentRepository;
  transactions: TransactionRunner;
  activity: ActivityService;
  now: () => Date;
}

function parseTxRef(txRef: string): { teamId: string } | undefined {
  const parts = txRef.split(".");
  if (parts.length !== 3 || parts[0] !== "rota") return undefined;
  return { teamId: parts[1] };
}

export function createBillingWebhookWorker(
  deps: BillingWorkerDeps,
): Processor<{ eventKey: string; teamId: string; txRef: string }> {
  return async (job) => {
    const { eventKey, teamId, txRef } = job.data;
    const parsed = parseTxRef(txRef);
    const shardTeamId = parsed?.teamId ?? teamId;

    await deps
      .transactions(shardTeamId, async (executor) => {
        await incrementWebhookAttempts(executor, eventKey);
      })
      .catch(() => undefined);

    const event = await deps.transactions(shardTeamId, async (executor) =>
      getWebhookEventOnShard(executor, eventKey),
    );
    if (event === undefined || event.processedAt !== null) {
      return;
    }

    const payload = event.payload as { data?: { id?: string | number }; id?: string | number };
    const providerTxId = String(payload?.data?.id ?? payload?.id ?? "");
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
        error: getErrorMessage(error),
      });
      throw error;
    }

    const result = await applyVerifiedPayment(
      {
        paymentRepository: deps.paymentRepository,
        repository: deps.repository,
        transactions: deps.transactions,
        activity: deps.activity,
        now: deps.now,
      },
      { teamId: shardTeamId, txRef, verified },
    );

    await deps.transactions(shardTeamId, async (executor) => {
      await markWebhookProcessed(executor, eventKey);
    });

    if (result === "mismatch") {
      logger.warn("billing webhook verification mismatch", { eventKey });
    }
    if (result === "duplicate") {
      logger.info("billing webhook payment already applied", { eventKey });
    }
  };
}
