import { HttpError } from "../../lib/errors.js";
import type { ActivityService } from "../activity/types.js";
import type { TeamsService } from "../teams/types.js";
import type { TransactionRunner } from "../../db/types.js";
import type {
  ShiftRecord,
  ShiftTimes,
  ShiftUpdate,
  ShiftView,
  ShiftsRepository,
  ShiftsService,
} from "./types.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_SHIFT_MS = DAY_MS;
const MAX_LOOKAHEAD_MS = 365 * DAY_MS;
const MAX_LIST_RANGE_MS = 62 * DAY_MS;

export interface ShiftsServiceDeps {
  repository: ShiftsRepository;
  activity: ActivityService;
  teamsService: TeamsService;
  transactions: TransactionRunner;
  now: () => Date;
}

function overlapError(): HttpError {
  return new HttpError(409, "This shift overlaps another shift for that person");
}

function toView(shift: ShiftRecord): ShiftView {
  return {
    id: shift.id,
    assigneeId: shift.assigneeId,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
  };
}

function shiftPayload(shift: Pick<ShiftRecord, "id" | "assigneeId" | "startsAt" | "endsAt">) {
  return {
    shiftId: shift.id,
    assigneeId: shift.assigneeId,
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
  };
}

function assertTimes(startsAt: Date, endsAt: Date, now: Date): void {
  const duration = endsAt.getTime() - startsAt.getTime();
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SHIFT_MS) {
    throw new HttpError(400, "Invalid request");
  }

  if (startsAt.getTime() - now.getTime() > MAX_LOOKAHEAD_MS) {
    throw new HttpError(400, "Invalid request");
  }
}

export function createShiftsService(deps: ShiftsServiceDeps): ShiftsService {
  async function assertAssignee(teamId: string, assigneeId: string): Promise<void> {
    const membership = await deps.teamsService.getMembership(teamId, assigneeId);
    if (membership === undefined) {
      throw new HttpError(404, "Team not found");
    }
  }

  return {
    async create(teamId, userId, input: ShiftTimes) {
      await assertAssignee(teamId, input.assigneeId);
      assertTimes(input.startsAt, input.endsAt, deps.now());

      const shift = await deps.transactions(teamId, async (executor) => {
        await deps.repository.lockAssignee(executor, teamId, input.assigneeId);

        if (
          await deps.repository.findOverlap(executor, {
            teamId,
            ...input,
          })
        ) {
          throw overlapError();
        }

        const created = await deps.repository.create(executor, {
          teamId,
          ...input,
          createdBy: userId,
        });

        await deps.activity.record(executor, {
          teamId,
          type: "shift_created",
          actorId: userId,
          payload: shiftPayload(created),
        });

        return created;
      });

      return toView(shift);
    },

    async list(teamId, userId, filter) {
      const range = filter.to.getTime() - filter.from.getTime();
      if (!Number.isFinite(range) || range <= 0 || range > MAX_LIST_RANGE_MS) {
        throw new HttpError(400, "Invalid request");
      }

      const shifts = await deps.repository.list({
        teamId,
        from: filter.from,
        to: filter.to,
        assigneeId: filter.mine ? userId : filter.assigneeId,
      });

      return shifts.map(toView);
    },

    async update(teamId, userId, shiftId, input: ShiftUpdate) {
      const current = await deps.repository.find(teamId, shiftId);
      if (current === undefined) {
        throw new HttpError(404, "Shift not found");
      }

      const times: ShiftTimes = {
        assigneeId: input.assigneeId ?? current.assigneeId,
        startsAt: input.startsAt ?? current.startsAt,
        endsAt: input.endsAt ?? current.endsAt,
      };

      await assertAssignee(teamId, times.assigneeId);
      assertTimes(times.startsAt, times.endsAt, deps.now());

      const result = await deps.transactions(teamId, async (executor) => {
        const lockTargets = [...new Set([current.assigneeId, times.assigneeId])].sort();
        for (const assigneeId of lockTargets) {
          await deps.repository.lockAssignee(executor, teamId, assigneeId);
        }

        if (
          await deps.repository.findOverlap(executor, {
            teamId,
            ...times,
            excludeShiftId: shiftId,
          })
        ) {
          throw overlapError();
        }

        const updated = await deps.repository.update(
          executor,
          teamId,
          shiftId,
          times,
        );
        if (updated === undefined) {
          throw new HttpError(404, "Shift not found");
        }

        await deps.activity.record(executor, {
          teamId,
          type: "shift_updated",
          actorId: userId,
          payload: shiftPayload(updated.shift),
        });

        if (updated.cancelledSwapId !== null) {
          await deps.activity.record(executor, {
            teamId,
            type: "swap_cancelled",
            actorId: userId,
            payload: {
              shiftId,
              swapRequestId: updated.cancelledSwapId,
            },
          });
        }

        return updated.shift;
      });

      return toView(result);
    },

    async remove(teamId, userId, shiftId) {
      const current = await deps.repository.find(teamId, shiftId);
      if (current === undefined) {
        throw new HttpError(404, "Shift not found");
      }

      const removed = await deps.transactions(teamId, async (executor) => {
        const didRemove = await deps.repository.remove(executor, teamId, shiftId);
        if (!didRemove) {
          throw new HttpError(404, "Shift not found");
        }

        await deps.activity.record(executor, {
          teamId,
          type: "shift_deleted",
          actorId: userId,
          payload: shiftPayload(current),
        });
      });

      return removed;
    },
  };
}
