import express, { Router } from "express";

import { logger } from "../../lib/logger.js";
import { billingWebhookRateLimit, type RateLimiter } from "../../middleware/rateLimit.js";
import type { PaymentProvider } from "../../providers/payments/types.js";
import type { BillingQueue } from "../../jobs/billingQueueAdapter.js";
import { createWebhookRepository, getWebhookEventOnShard } from "./paymentRepository.js";
import { getShardFor } from "../../db/shard.js";

export interface BillingWebhookDeps {
  provider: PaymentProvider;
  queue: BillingQueue;
  limiter: RateLimiter;
}

function parseTxRef(txRef: string): { teamId: string; paymentId: string } | undefined {
  const parts = txRef.split(".");
  if (parts.length !== 3 || parts[0] !== "rota") return undefined;
  const [, teamId, paymentId] = parts;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(teamId) || !uuid.test(paymentId)) return undefined;
  return { teamId, paymentId };
}

export function createBillingWebhookRouter(deps: BillingWebhookDeps): Router {
  const router = Router();
  const webhooks = createWebhookRepository();

  function ignore(payload: unknown, res: express.Response): void {
    const summary = deps.provider.describeIgnoredWebhook(payload);
    logger.info("billing webhook ignored", {
      topLevelKeys: summary.topLevelKeys,
      dataKeys: summary.dataKeys,
      ...(summary.eventName !== undefined ? { eventName: summary.eventName } : {}),
    });
    res.status(200).json({ status: "ignored" });
  }

  router.post(
    "/",
    billingWebhookRateLimit(deps.limiter),
    express.raw({ type: "*/*", limit: "64kb" }),
    async (req, res) => {
      if (!deps.provider.verifyWebhookAuth(req.headers as Record<string, string | string[] | undefined>)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      let payload: unknown;
      try {
        const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
        payload = JSON.parse(raw);
      } catch {
        res.status(400).json({ error: "Invalid request" });
        return;
      }

      const parsed = deps.provider.parseWebhook(payload);
      if (parsed === undefined) {
        ignore(payload, res);
        return;
      }

      const parsedRef = parseTxRef(parsed.txRef);
      if (parsedRef === undefined) {
        ignore(payload, res);
        return;
      }

      const eventKey = `charge.completed:${parsed.providerTxId}:${parsed.dedupeStatus}`;
      const safePayload = {
        event: parsed.eventName,
        data: {
          id: parsed.providerTxId,
          tx_ref: parsed.txRef,
        },
      };

      let insertResult: "inserted" | "duplicate";
      try {
        insertResult = await webhooks.insertEvent({
          eventKey,
          teamId: parsedRef.teamId,
          provider: "flutterwave",
          txRef: parsed.txRef,
          payload: safePayload,
        });
      } catch {
        logger.error("webhook event store failed");
        res.status(500).json({ error: "Service unavailable" });
        return;
      }

      if (insertResult === "duplicate") {
        try {
          const existing = await getWebhookEventOnShard(getShardFor(parsedRef.teamId), eventKey);
          if (existing?.processedAt) {
            res.status(200).json({ status: "duplicate" });
            return;
          }
        } catch {
          logger.error("webhook duplicate lookup failed");
          res.status(500).json({ error: "Service unavailable" });
          return;
        }
        try {
          await deps.queue.enqueueWebhook({ eventKey, teamId: parsedRef.teamId, txRef: parsed.txRef });
        } catch {
          logger.error("webhook re-enqueue failed");
          res.status(500).json({ error: "Service unavailable" });
          return;
        }
        res.status(200).json({ status: "duplicate" });
        return;
      }

      try {
        await deps.queue.enqueueWebhook({ eventKey, teamId: parsedRef.teamId, txRef: parsed.txRef });
      } catch {
        logger.error("webhook enqueue failed after store");
        res.status(500).json({ error: "Service unavailable" });
        return;
      }

      res.status(200).json({ status: "queued" });
    },
  );

  return router;
}
