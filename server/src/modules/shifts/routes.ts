import { Router } from "express";

import { HttpError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  shiftListRateLimit,
  type RateLimiter,
} from "../../middleware/rateLimit.js";
import { requireTeamRole } from "../../middleware/teamRole.js";
import { requireWritableTeam } from "../../middleware/writableTeam.js";
import type { AuthService } from "../auth/service.js";
import type { BillingService } from "../billing/types.js";
import type { TeamsService } from "../teams/types.js";
import {
  createShiftSchema,
  shiftIdSchema,
  shiftListQuerySchema,
  updateShiftSchema,
} from "./schema.js";
import type { ShiftsService } from "./types.js";

export function createShiftsRouter(
  authService: AuthService,
  service: ShiftsService,
  teamsService: TeamsService,
  billingService: BillingService,
  limiter: RateLimiter,
): Router {
  const router = Router();

  router.post(
    "/teams/:teamId/shifts",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner", "manager"),
    requireWritableTeam(billingService),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsed = createShiftSchema.safeParse(req.body);
      if (teamId === undefined || req.user === undefined || !parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.status(201).json(
          await service.create(teamId, req.user.id, parsed.data),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/teams/:teamId/shifts",
    requireAuth(authService),
    requireTeamRole(teamsService),
    shiftListRateLimit(limiter),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsed = shiftListQuerySchema.safeParse(req.query);
      if (teamId === undefined || req.user === undefined || !parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.json(
          await service.list(teamId, req.user.id, {
            from: parsed.data.from,
            to: parsed.data.to,
            mine: parsed.data.mine ?? false,
            assigneeId: parsed.data.assigneeId,
          }),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/teams/:teamId/shifts/:shiftId",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner", "manager"),
    requireWritableTeam(billingService),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsedShift = shiftIdSchema.safeParse(req.params.shiftId);
      const parsedBody = updateShiftSchema.safeParse(req.body);
      if (
        teamId === undefined ||
        req.user === undefined ||
        !parsedShift.success ||
        !parsedBody.success
      ) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.json(
          await service.update(
            teamId,
            req.user.id,
            parsedShift.data,
            parsedBody.data,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/teams/:teamId/shifts/:shiftId",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner", "manager"),
    requireWritableTeam(billingService),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsedShift = shiftIdSchema.safeParse(req.params.shiftId);
      if (teamId === undefined || req.user === undefined || !parsedShift.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        await service.remove(teamId, req.user.id, parsedShift.data);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
