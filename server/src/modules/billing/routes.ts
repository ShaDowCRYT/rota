import { Router } from "express";

import { HttpError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import { billingQuoteRateLimit, type RateLimiter } from "../../middleware/rateLimit.js";
import { requireTeamRole } from "../../middleware/teamRole.js";
import type { AuthService } from "../auth/service.js";
import type { TeamsService } from "../teams/types.js";
import { quoteRequestSchema } from "./schema.js";
import { toHttpError } from "./proration.js";
import type { BillingService } from "./types.js";

export function createBillingRouter(
  authService: AuthService,
  service: BillingService,
  teamsService: TeamsService,
  limiter: RateLimiter,
): Router {
  const router = Router();

  router.get(
    "/teams/:teamId/billing",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner"),
    async (req, res, next) => {
      const teamId = req.team?.id;
      if (teamId === undefined) {
        next(new HttpError(401, "Unauthorized"));
        return;
      }
      try {
        res.json(await service.getStatus(teamId));
      } catch (error) {
        next(toHttpError(error) ?? error);
      }
    },
  );

  router.get(
    "/teams/:teamId/billing/plans",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner"),
    async (_req, res, next) => {
      try {
        res.json(await service.getPlans());
      } catch (error) {
        next(toHttpError(error) ?? error);
      }
    },
  );

  router.post(
    "/teams/:teamId/billing/quote",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner"),
    billingQuoteRateLimit(limiter),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsed = quoteRequestSchema.safeParse(req.body);
      if (teamId === undefined || !parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }
      try {
        res.json(await service.quoteChange(teamId, parsed.data));
      } catch (error) {
        next(toHttpError(error) ?? error);
      }
    },
  );

  return router;
}
