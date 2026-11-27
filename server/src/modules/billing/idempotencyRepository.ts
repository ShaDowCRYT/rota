import { and, eq, sql } from "drizzle-orm";

import { idempotencyKeys } from "../../db/schema/global.js";
import type { IdempotencyRecord, IdempotencyRepository } from "./idempotency.js";

export function createIdempotencyRepository(): IdempotencyRepository {
  return {
    async insertInProgress(db, userId, key, requestHash) {
      const rows = await db.execute(sql`
        insert into "idempotency_keys" ("user_id", "key", "request_hash", "status", "response_status", "response_body")
        values (${userId}::uuid, ${key}, ${requestHash}, 'in_progress', null, null)
        on conflict ("user_id", "key") do nothing
        returning "user_id"
      `);
      return rows.rows.length > 0;
    },

    async get(db, userId, key) {
      const rows = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return undefined;
      return {
        status: row.status as IdempotencyRecord["status"],
        requestHash: row.requestHash,
        responseStatus: row.responseStatus,
        responseBody: row.responseBody,
      };
    },

    async markCompleted(db, userId, key, requestHash, responseStatus, responseBody) {
      await db
        .update(idempotencyKeys)
        .set({ status: "completed", responseStatus, responseBody })
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.requestHash, requestHash),
          ),
        );
    },

    async deleteInProgress(db, userId, key, requestHash) {
      await db
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.requestHash, requestHash),
            eq(idempotencyKeys.status, "in_progress"),
          ),
        );
    },
  };
}
