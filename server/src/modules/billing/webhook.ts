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

  router.post(
    "/",
    billingWebhookRateLimit(deps.limiter),
    express.raw({ type: "*/*", limit: "64kb" }),
    async (req, res) => {
      // 1) Verify auth header before parsing/storing.
      if (!deps.provider.verifyWebhookAuth(req.headers as Record<string, string | string[] | undefined>)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      // 2) Parse JSON after signature check.
      let payload: unknown;
      try {
        const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");
        payload = JSON.parse(raw);
      } catch {
        res.status(400).json({ error: "Invalid request" });
        return;
      }

      const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
      const event = typeof record?.event === "string" ? record.event : undefined;
      const data = record?.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : undefined;
      if (event !== "charge.completed" || data === undefined) {
        res.status(200).json({ status: "ignored" });
        return;
      }

      const txRef = typeof data.tx_ref === "string" ? data.tx_ref : undefined;
      const providerTxId = data.id;
      const status = typeof data.status === "string" ? data.status : undefined;
      const amount = data.amount;
      const currency = typeof data.currency === "string" ? data.currency : undefined;
      if (txRef === undefined || providerTxId === undefined || status === undefined) {
        res.status(200).json({ status: "ignored" });
        return;
      }

      const parsedRef = parseTxRef(txRef);
      if (parsedRef === undefined) {
        res.status(200).json({ status: "ignored" });
        return;
      }

      const eventKey = `charge.completed:${String(providerTxId)}:${status}`;
      const safePayload = {
        event,
        data: {
          id: String(providerTxId),
          tx_ref: txRef,
          status,
          amount: typeof amount === "number" || typeof amount === "string" ? amount : null,
          currency: currency ?? null,
        },
      };

      let insertResult: "inserted" | "duplicate";
      try {
        insertResult = await webhooks.insertEvent({
          eventKey,
          teamId: parsedRef.teamId,
          provider: "flutterwave",
          txRef,
          payload: safePayload,
        });
      } catch (error) {
        logger.error("webhook event store failed", { error: error instanceof Error ? error.message : String(error) });
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
        } catch (error) {
          logger.error("webhook duplicate lookup failed", { error: error instanceof Error ? error.message : String(error) });
          res.status(500).json({ error: "Service unavailable" });
          return;
        }
        try {
          await deps.queue.enqueueWebhook({ eventKey, teamId: parsedRef.teamId, txRef });
        } catch (error) {
          logger.error("webhook re-enqueue failed", { error: error instanceof Error ? error.message : String(error) });
          res.status(500).json({ error: "Service unavailable" });
          return;
        }
        res.status(200).json({ status: "duplicate" });
        return;
      }

      try {
        await deps.queue.enqueueWebhook({ eventKey, teamId: parsedRef.teamId, txRef });
      } catch (error) {
        logger.error("webhook enqueue failed after store", { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ error: "Service unavailable" });
        return;
      }

      res.status(200).json({ status: "queued" });
    },
  );

  return router;
}
