import { getErrorMessage } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import type { BillingQueue } from "../../jobs/billingQueueAdapter.js";
import { listUnprocessedOnShard } from "./paymentRepository.js";
import { getAllShards } from "../../db/shard.js";

export async function reenqueueUnprocessedWebhookEvents(
  queue: BillingQueue,
  limit = 100,
): Promise<number> {
  const shards = getAllShards();
  const rows = [];
  for (const shard of shards) {
    try {
      const shardRows = await listUnprocessedOnShard(shard, limit);
      rows.push(...shardRows);
    } catch (error) {
      logger.warn("failed to list unprocessed webhooks", {
        error: getErrorMessage(error),
      });
    }
  }
  rows.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const selected = rows.slice(0, limit);
  let count = 0;
  for (const row of selected) {
    try {
      await queue.enqueueWebhook({ eventKey: row.eventKey, teamId: row.teamId, txRef: row.txRef });
      count += 1;
    } catch (error) {
      logger.warn("failed to re-enqueue unprocessed webhook", {
        error: getErrorMessage(error),
      });
    }
  }
  return count;
}
