import { sql } from "drizzle-orm";

import { getShardFor } from "../../db/shard.js";
import { toDate, toNullableDate } from "../../lib/time.js";
import type { SqlExecutor } from "../../db/types.js";
import type { ShiftRecord } from "../shifts/types.js";
import type {
  DecideOutcome,
  NewSwapRequest,
  ShiftForSwap,
  SwapListFilter,
  SwapRequestRecord,
  SwapStatus,
  SwapsRepository,
} from "./types.js";

const swapColumns = sql`
  id::text as id,
  team_id::text as team_id,
  shift_id::text as shift_id,
  requester_id::text as requester_id,
  target_id::text as target_id,
  status,
  decided_by::text as decided_by,
  created_at,
  decided_at
`;

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

function toSwapRecord(row: Record<string, unknown>): SwapRequestRecord {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    shiftId: String(row.shift_id),
    requesterId: String(row.requester_id),
    targetId: optionalText(row.target_id),
    status: String(row.status) as SwapStatus,
    decidedBy: optionalText(row.decided_by),
    createdAt: toDate(row.created_at),
    decidedAt: toNullableDate(row.decided_at),
  };
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

async function hasOverlap(
  executor: SqlExecutor,
  teamId: string,
  assigneeId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<boolean> {
  const result = await executor.execute(sql`
    select 1
    from shifts
    where team_id = ${teamId}::uuid
      and assignee_id = ${assigneeId}::uuid
      and starts_at < ${endsAt}::timestamptz
      and ends_at > ${startsAt}::timestamptz
    limit 1
  `);

  return result.rows.length > 0;
}

export function createSwapsRepository(): SwapsRepository {
  return {
    async findShiftForSwap(teamId, shiftId) {
      const result = await getShardFor(teamId).execute(sql`
        select
          id::text as id,
          assignee_id::text as assignee_id,
          starts_at,
          ends_at
        from shifts
        where team_id = ${teamId}::uuid and id = ${shiftId}::uuid
        limit 1
      `);

      const row = result.rows[0];
      if (row === undefined) {
        return undefined;
      }

      return {
        id: String(row.id),
        assigneeId: String(row.assignee_id),
        startsAt: toDate(row.starts_at),
        endsAt: toDate(row.ends_at),
      } satisfies ShiftForSwap;
    },

    async lockAssignee(executor, teamId, assigneeId) {
      await executor.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${teamId} || ':' || ${assigneeId}, 0)
        )
      `);
    },

    findOverlap(executor, teamId, assigneeId, startsAt, endsAt) {
      return hasOverlap(executor, teamId, assigneeId, startsAt, endsAt);
    },

    async create(executor, input: NewSwapRequest) {
      const result = await executor.execute(sql`
        insert into swap_requests (team_id, shift_id, requester_id, target_id)
        values (
          ${input.teamId}::uuid,
          ${input.shiftId}::uuid,
          ${input.requesterId}::uuid,
          ${input.targetId === null ? null : sql`${input.targetId}::uuid`}
        )
        returning ${swapColumns}
      `);

      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("Swap request insert returned no row");
      }
      return toSwapRecord(row);
    },

    async find(teamId, requestId) {
      const result = await getShardFor(teamId).execute(sql`
        select ${swapColumns}
        from swap_requests
        where team_id = ${teamId}::uuid and id = ${requestId}::uuid
        limit 1
      `);

      const row = result.rows[0];
      return row === undefined ? undefined : toSwapRecord(row);
    },

    async list(filter: SwapListFilter) {
      const statusCondition =
        filter.status === undefined
          ? sql`true`
          : sql`status = ${filter.status}::swap_request_status`;
      const visibility = filter.isManager
        ? sql`true`
        : sql`(requester_id = ${filter.viewerId}::uuid or target_id = ${filter.viewerId}::uuid)`;

      const result = await getShardFor(filter.teamId).execute(sql`
        select ${swapColumns}
        from swap_requests
        where team_id = ${filter.teamId}::uuid
          and ${statusCondition}
          and ${visibility}
        order by created_at desc, id desc
      `);

      return result.rows.map(toSwapRecord);
    },

    async decide(
      executor,
      teamId,
      requestId,
      status,
      decidedBy,
      assigneeId,
    ): Promise<DecideOutcome> {
      const locked = await executor.execute(sql`
        select ${swapColumns}
        from swap_requests
        where team_id = ${teamId}::uuid and id = ${requestId}::uuid
        for update
      `);

      const lockedRow = locked.rows[0];
      if (lockedRow === undefined) {
        return { kind: "not_found" };
      }

      const request = toSwapRecord(lockedRow);
      if (request.status !== "pending") {
        return { kind: "already_decided" };
      }

      let shift: ShiftRecord | undefined;
      if (status === "approved") {
        if (assigneeId === undefined) {
          return { kind: "not_found" };
        }

        const initialShift = await executor.execute(sql`
          select ${shiftColumns}
          from shifts
          where team_id = ${teamId}::uuid and id = ${request.shiftId}::uuid
          limit 1
        `);

        const initialRow = initialShift.rows[0];
        if (initialRow === undefined) {
          return { kind: "not_found" };
        }

        const initial = toShiftRecord(initialRow);
        if (initial.assigneeId !== request.requesterId) {
          return { kind: "assignee_changed" };
        }

        const lockTargets = [
          ...new Set([request.requesterId, assigneeId]),
        ].sort();
        for (const target of lockTargets) {
          await executor.execute(sql`
            select pg_advisory_xact_lock(
              hashtextextended(${teamId} || ':' || ${target}, 0)
            )
          `);
        }

        const lockedShift = await executor.execute(sql`
          select ${shiftColumns}
          from shifts
          where team_id = ${teamId}::uuid and id = ${request.shiftId}::uuid
          for update
        `);

        const lockedShiftRow = lockedShift.rows[0];
        if (lockedShiftRow === undefined) {
          return { kind: "not_found" };
        }

        shift = toShiftRecord(lockedShiftRow);
        if (shift.assigneeId !== request.requesterId) {
          return { kind: "assignee_changed" };
        }

        if (
          await hasOverlap(
            executor,
            teamId,
            assigneeId,
            shift.startsAt,
            shift.endsAt,
          )
        ) {
          return { kind: "overlap" };
        }
      }

      const updated = await executor.execute(sql`
        update swap_requests
        set status = ${status}::swap_request_status,
            decided_by = ${decidedBy}::uuid,
            decided_at = now()
        where id = ${requestId}::uuid and status = 'pending'
        returning ${swapColumns}
      `);

      const updatedRow = updated.rows[0];
      if (updatedRow === undefined) {
        return { kind: "already_decided" };
      }

      let updatedShift: ShiftRecord | undefined;
      if (status === "approved" && assigneeId !== undefined) {
        const changed = await executor.execute(sql`
          update shifts
          set assignee_id = ${assigneeId}::uuid, updated_at = now()
          where team_id = ${teamId}::uuid and id = ${request.shiftId}::uuid
          returning ${shiftColumns}
        `);

        const changedRow = changed.rows[0];
        if (changedRow === undefined) {
          return { kind: "not_found" };
        }
        updatedShift = toShiftRecord(changedRow);
      }

      return {
        kind: "decided",
        request: toSwapRecord(updatedRow),
        shift: updatedShift,
      };
    },
  };
}
