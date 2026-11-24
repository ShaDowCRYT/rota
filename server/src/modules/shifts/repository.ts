import { sql } from "drizzle-orm";

import { getShardFor } from "../../db/shard.js";
import { toDate } from "../../lib/time.js";
import type {
  NewShift,
  ShiftListFilter,
  ShiftOverlapInput,
  ShiftRecord,
  ShiftTimes,
  ShiftUpdateResult,
  ShiftsRepository,
} from "./types.js";

const shiftColumns = sql`
  id::text as id,
  team_id::text as team_id,
  assignee_id::text as assignee_id,
  starts_at,
  ends_at,
  created_by::text as created_by,
  created_at,
  updated_at
`;

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toShiftRecord(row: Record<string, unknown>): ShiftRecord {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    assigneeId: String(row.assignee_id),
    startsAt: toDate(row.starts_at),
    endsAt: toDate(row.ends_at),
    createdBy: optionalText(row.created_by),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export function createShiftsRepository(): ShiftsRepository {
  return {
    async lockAssignee(executor, teamId, assigneeId) {
      await executor.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${teamId} || ':' || ${assigneeId}, 0)
        )
      `);
    },

    async findOverlap(executor, input: ShiftOverlapInput) {
      const exclusion =
        input.excludeShiftId === undefined
          ? sql`true`
          : sql`id <> ${input.excludeShiftId}::uuid`;

      const result = await executor.execute(sql`
        select 1
        from shifts
        where team_id = ${input.teamId}::uuid
          and assignee_id = ${input.assigneeId}::uuid
          and starts_at < ${input.endsAt}::timestamptz
          and ends_at > ${input.startsAt}::timestamptz
          and ${exclusion}
        limit 1
      `);

      return result.rows.length > 0;
    },

    async create(executor, input: NewShift) {
      const result = await executor.execute(sql`
        insert into shifts (team_id, assignee_id, starts_at, ends_at, created_by)
        values (
          ${input.teamId}::uuid,
          ${input.assigneeId}::uuid,
          ${input.startsAt}::timestamptz,
          ${input.endsAt}::timestamptz,
          ${input.createdBy}::uuid
        )
        returning ${shiftColumns}
      `);

      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("Shift insert returned no row");
      }
      return toShiftRecord(row);
    },

    async find(teamId, shiftId) {
      const result = await getShardFor(teamId).execute(sql`
        select ${shiftColumns}
        from shifts
        where team_id = ${teamId}::uuid and id = ${shiftId}::uuid
        limit 1
      `);

      const row = result.rows[0];
      return row === undefined ? undefined : toShiftRecord(row);
    },

    async list(filter: ShiftListFilter) {
      const assigneeCondition =
        filter.assigneeId === undefined
          ? sql`true`
          : sql`assignee_id = ${filter.assigneeId}::uuid`;

      const result = await getShardFor(filter.teamId).execute(sql`
        select ${shiftColumns}
        from shifts
        where team_id = ${filter.teamId}::uuid
          and starts_at >= ${filter.from}::timestamptz
          and starts_at < ${filter.to}::timestamptz
          and ${assigneeCondition}
        order by starts_at asc, id asc
        limit 500
      `);

      return result.rows.map(toShiftRecord);
    },

    async update(executor, teamId, shiftId, input: ShiftTimes) {
      const locked = await executor.execute(sql`
        select assignee_id::text as assignee_id
        from shifts
        where team_id = ${teamId}::uuid and id = ${shiftId}::uuid
        for update
      `);

      const current = locked.rows[0];
      if (current === undefined) {
        return undefined;
      }

      let cancelledSwapId: string | null = null;
      if (String(current.assignee_id) !== input.assigneeId) {
        const pending = await executor.execute(sql`
          select id::text as id
          from swap_requests
          where team_id = ${teamId}::uuid
            and shift_id = ${shiftId}::uuid
            and status = 'pending'
          limit 1
        `);

        const swapId = pending.rows[0]?.id;
        if (typeof swapId === "string") {
          await executor.execute(sql`
            update swap_requests
            set status = 'cancelled', decided_at = now()
            where id = ${swapId}::uuid and status = 'pending'
          `);
          cancelledSwapId = swapId;
        }
      }

      const result = await executor.execute(sql`
        update shifts
        set assignee_id = ${input.assigneeId}::uuid,
            starts_at = ${input.startsAt}::timestamptz,
            ends_at = ${input.endsAt}::timestamptz,
            updated_at = now()
        where team_id = ${teamId}::uuid and id = ${shiftId}::uuid
        returning ${shiftColumns}
      `);

      const row = result.rows[0];
      if (row === undefined) {
        return undefined;
      }

      return { shift: toShiftRecord(row), cancelledSwapId } satisfies ShiftUpdateResult;
    },

    async remove(executor, teamId, shiftId) {
      const result = await executor.execute(sql`
        delete from shifts
        where team_id = ${teamId}::uuid and id = ${shiftId}::uuid
        returning ${shiftColumns}
      `);

      return result.rows[0] !== undefined;
    },
  };
}
