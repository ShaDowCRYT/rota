import { sql } from "drizzle-orm";

import { getShardFor } from "../../db/shard.js";
import { toDate } from "../../lib/time.js";
import type { SqlExecutor } from "../../db/types.js";
import type { ActivityRepository, ActivityRow } from "./types.js";

function toActivityRow(row: Record<string, unknown>): ActivityRow {
  const payload = row.payload;
  return {
    id: String(row.id),
    type: String(row.type),
    actorId: String(row.actor_id),
    payload:
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>)
        : {},
    createdAtText: String(row.created_at_text),
    createdAtDate: toDate(row.created_at),
  };
}

export function createActivityRepository(): ActivityRepository {
  return {
    async append(executor: SqlExecutor, event) {
      await executor.execute(sql`
        insert into activity_events (team_id, type, actor_id, payload)
        values (
          ${event.teamId},
          ${event.type},
          ${event.actorId},
          ${JSON.stringify(event.payload)}::jsonb
        )
      `);
    },

    async list(teamId, cursorTimeText, cursorId, limit) {
      const cursorCondition =
        cursorTimeText === undefined || cursorId === undefined
          ? sql`true`
          : sql`(created_at, id) < (${cursorTimeText}::timestamptz, ${cursorId}::uuid)`;

      const result = await getShardFor(teamId).execute(sql`
        select
          id::text as id,
          type,
          actor_id::text as actor_id,
          payload,
          created_at::text as created_at_text,
          created_at
        from activity_events
        where team_id = ${teamId} and ${cursorCondition}
        order by activity_events.created_at desc, activity_events.id desc
        limit ${limit + 1}
      `);

      const rows = result.rows.map(toActivityRow);
      return {
        rows: rows.slice(0, limit),
        hasMore: rows.length > limit,
      };
    },

    async cursorTimeIsValid(teamId, text) {
      try {
        await getShardFor(teamId).execute(sql`select ${text}::timestamptz`);
        return true;
      } catch {
        return false;
      }
    },
  };
}
