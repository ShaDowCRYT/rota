import { Router } from "express";

import { HttpError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  swapListRateLimit,
  type RateLimiter,
} from "../../middleware/rateLimit.js";
import { requireTeamRole } from "../../middleware/teamRole.js";
import { requireWritableTeam } from "../../middleware/writableTeam.js";
import type { AuthService } from "../auth/service.js";
import type { BillingService } from "../billing/types.js";
import type { TeamsService } from "../teams/types.js";
import {
  approveSwapSchema,
  createSwapRequestSchema,
  rejectSwapSchema,
  swapListQuerySchema,
  swapRequestIdSchema,
} from "./schema.js";
import type { SwapsService } from "./types.js";

export function createSwapsRouter(
  authService: AuthService,
  service: SwapsService,
  teamsService: TeamsService,
  billingService: BillingService,
  limiter: RateLimiter,
): Router {
  const router = Router();

  router.post(
    "/teams/:teamId/shifts/:shiftId/swap-requests",
    requireAuth(authService),
    requireTeamRole(teamsService),
    requireWritableTeam(billingService),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsedShift = swapRequestIdSchema.safeParse(req.params.shiftId);
      const parsedBody = createSwapRequestSchema.safeParse(req.body ?? {});
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
        res.status(201).json(
          await service.request(
            teamId,
            req.user.id,
            parsedShift.data,
            parsedBody.data.targetId ?? null,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/teams/:teamId/swap-requests",
    requireAuth(authService),
    requireTeamRole(teamsService),
    swapListRateLimit(limiter),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const role = req.team?.role;
      const parsed = swapListQuerySchema.safeParse(req.query);
      if (
        teamId === undefined ||
        req.user === undefined ||
        role === undefined ||
        !parsed.success
      ) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.json(
          await service.list(
            teamId,
            req.user.id,
            role !== "staff",
            parsed.data.status,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/teams/:teamId/swap-requests/:requestId/approve",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner", "manager"),
    requireWritableTeam(billingService),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsedRequest = swapRequestIdSchema.safeParse(req.params.requestId);
      const parsedBody = approveSwapSchema.safeParse(req.body ?? {});
      if (
        teamId === undefined ||
        req.user === undefined ||
        !parsedRequest.success ||
        !parsedBody.success
      ) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.json(
          await service.decide(
            teamId,
            req.user.id,
            parsedRequest.data,
            "approved",
            parsedBody.data.assigneeId,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/teams/:teamId/swap-requests/:requestId/reject",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner", "manager"),
    requireWritableTeam(billingService),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsedRequest = swapRequestIdSchema.safeParse(req.params.requestId);
      const parsedBody = rejectSwapSchema.safeParse(req.body ?? {});
      if (
        teamId === undefined ||
        req.user === undefined ||
        !parsedRequest.success ||
        !parsedBody.success
      ) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.json(
          await service.decide(
            teamId,
            req.user.id,
            parsedRequest.data,
            "rejected",
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/teams/:teamId/swap-requests/:requestId/cancel",
    requireAuth(authService),
    requireTeamRole(teamsService),
    requireWritableTeam(billingService),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsedRequest = swapRequestIdSchema.safeParse(req.params.requestId);
      if (teamId === undefined || req.user === undefined || !parsedRequest.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        await service.cancel(teamId, req.user.id, parsedRequest.data);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
