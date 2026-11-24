import type { TransactionRunner } from "../../db/types.js";
import { HttpError, isUniqueViolation } from "../../lib/errors.js";
import type { ActivityService } from "../activity/types.js";
import type { TeamsService } from "../teams/types.js";
import type { SwapRequestRecord, SwapRequestView, SwapsRepository, SwapsService } from "./types.js";

export interface SwapsServiceDeps {
  repository: SwapsRepository;
  activity: ActivityService;
  teamsService: TeamsService;
  transactions: TransactionRunner;
  now: () => Date;
}

function toView(request: SwapRequestRecord): SwapRequestView {
  return {
    id: request.id,
    shiftId: request.shiftId,
    requesterId: request.requesterId,
    targetId: request.targetId,
    status: request.status,
  };
}

function alreadyDecidedError(): HttpError {
  return new HttpError(409, "This request was already decided");
}

function overlapError(): HttpError {
  return new HttpError(409, "This shift overlaps another shift for that person");
}

function requestPayload(request: SwapRequestRecord) {
  return {
    swapRequestId: request.id,
    shiftId: request.shiftId,
    requesterId: request.requesterId,
    targetId: request.targetId,
    status: request.status,
  };
}

function recordedEvent(
  activity: ActivityService,
  executor: Parameters<ActivityService["record"]>[0],
  teamId: string,
  userId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  return activity.record(executor, { teamId, type, actorId: userId, payload });
}

export function createSwapsService(deps: SwapsServiceDeps): SwapsService {
  async function assertMember(teamId: string, userId: string): Promise<void> {
    const membership = await deps.teamsService.getMembership(teamId, userId);
    if (membership === undefined) {
      throw new HttpError(404, "Team not found");
    }
  }

  return {
    async request(teamId, userId, shiftId, targetId) {
      const shift = await deps.repository.findShiftForSwap(teamId, shiftId);
      if (shift === undefined) {
        throw new HttpError(404, "Shift not found");
      }

      if (shift.assigneeId !== userId) {
        throw new HttpError(403, "Forbidden");
      }

      if (shift.startsAt.getTime() <= deps.now().getTime()) {
        throw new HttpError(400, "Invalid request");
      }

      if (targetId !== null) {
        if (targetId === userId) {
          throw new HttpError(400, "Invalid request");
        }
        await assertMember(teamId, targetId);
      }

      try {
        return await deps.transactions(teamId, async (executor) => {
          const created = await deps.repository.create(executor, {
            teamId,
            shiftId,
            requesterId: userId,
            targetId,
          });

          await recordedEvent(
            deps.activity,
            executor,
            teamId,
            userId,
            "swap_requested",
            requestPayload(created),
          );

          return toView(created);
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HttpError(409, "A swap request is already pending");
        }
        throw error;
      }
    },

    async list(teamId, userId, isManager, status) {
      const requests = await deps.repository.list({
        teamId,
        status,
        viewerId: userId,
        isManager,
      });
      return requests.map(toView);
    },

    async decide(teamId, userId, requestId, decision, assigneeId) {
      const existing = await deps.repository.find(teamId, requestId);
      if (existing === undefined) {
        throw new HttpError(404, "Swap request not found");
      }

      const newAssigneeId = assigneeId ?? existing.targetId ?? undefined;
      if (decision === "approved" && newAssigneeId === undefined) {
        throw new HttpError(400, "Invalid request");
      }

      if (newAssigneeId !== undefined) {
        if (newAssigneeId === existing.requesterId) {
          throw new HttpError(400, "Invalid request");
        }
        await assertMember(teamId, newAssigneeId);
      }

      const outcome = await deps.transactions(teamId, async (executor) => {
        const result = await deps.repository.decide(
          executor,
          teamId,
          requestId,
          decision,
          userId,
          decision === "approved" ? newAssigneeId : undefined,
        );

        if (result.kind === "decided") {
          await recordedEvent(
            deps.activity,
            executor,
            teamId,
            userId,
            decision === "approved" ? "swap_approved" : "swap_rejected",
            requestPayload(result.request),
          );

          if (decision === "approved" && result.shift !== undefined) {
            await recordedEvent(
              deps.activity,
              executor,
              teamId,
              userId,
              "shift_updated",
              {
                shiftId: result.shift.id,
                assigneeId: result.shift.assigneeId,
                startsAt: result.shift.startsAt.toISOString(),
                endsAt: result.shift.endsAt.toISOString(),
              },
            );
          }
        }

        return result;
      });

      switch (outcome.kind) {
        case "decided":
          return toView(outcome.request);
        case "already_decided":
          throw alreadyDecidedError();
        case "not_found":
          throw new HttpError(404, "Swap request not found");
        case "assignee_changed":
          throw new HttpError(409, "This shift is no longer assigned to the requester");
        case "overlap":
          throw overlapError();
      }
    },

    async cancel(teamId, userId, requestId) {
      const existing = await deps.repository.find(teamId, requestId);
      if (existing === undefined) {
        throw new HttpError(404, "Swap request not found");
      }

      if (existing.requesterId !== userId) {
        throw new HttpError(403, "Forbidden");
      }

      const outcome = await deps.transactions(teamId, async (executor) => {
        const result = await deps.repository.decide(
          executor,
          teamId,
          requestId,
          "cancelled",
          userId,
        );

        if (result.kind === "decided") {
          await recordedEvent(
            deps.activity,
            executor,
            teamId,
            userId,
            "swap_cancelled",
            requestPayload(result.request),
          );
        }

        return result;
      });

      if (outcome.kind === "already_decided") {
        throw alreadyDecidedError();
      }
      if (outcome.kind === "not_found") {
        throw new HttpError(404, "Swap request not found");
      }
      if (outcome.kind !== "decided") {
        throw new HttpError(409, "This swap request cannot be cancelled");
      }
    },
  };
}
