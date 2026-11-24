import { Router } from "express";

import { HttpError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  activityFeedRateLimit,
  type RateLimiter,
} from "../../middleware/rateLimit.js";
import { requireTeamRole } from "../../middleware/teamRole.js";
import type { AuthService } from "../auth/service.js";
import type { TeamsService } from "../teams/types.js";
import { activityQuerySchema } from "./schema.js";
import type { ActivityService } from "./types.js";

export function createActivityRouter(
  authService: AuthService,
  service: ActivityService,
  teamsService: TeamsService,
  limiter: RateLimiter,
): Router {
  const router = Router();

  router.get(
    "/teams/:teamId/activity",
    requireAuth(authService),
    requireTeamRole(teamsService),
    activityFeedRateLimit(limiter),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsed = activityQuerySchema.safeParse(req.query);
      if (teamId === undefined || !parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.json(
          await service.list(teamId, parsed.data.cursor, parsed.data.limit),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
