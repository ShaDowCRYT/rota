import { Router } from "express";

import { HttpError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  createTeamRateLimit,
  inviteAcceptRateLimit,
  inviteCreateRateLimit,
  type RateLimiter,
} from "../../middleware/rateLimit.js";
import { requireTeamRole } from "../../middleware/teamRole.js";
import {
  acceptInviteSchema,
  changeRoleSchema,
  createInviteSchema,
  createTeamSchema,
  inviteIdSchema,
  userIdSchema,
} from "./schema.js";
import type { AuthService } from "../auth/service.js";
import type { TeamsService } from "./types.js";

export function createTeamsRouter(
  authService: AuthService,
  service: TeamsService,
  limiter: RateLimiter,
): Router {
  const router = Router();

  router.get("/teams", requireAuth(authService), async (req, res, next) => {
    if (req.user === undefined) {
      next(new HttpError(401, "Unauthorized"));
      return;
    }

    try {
      res.json(await service.listTeams(req.user.id));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/teams",
    requireAuth(authService),
    createTeamRateLimit(limiter),
    async (req, res, next) => {
    if (req.user === undefined) {
      next(new HttpError(401, "Unauthorized"));
      return;
    }

    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new HttpError(400, "Invalid request"));
      return;
    }

    try {
      res.status(201).json(await service.createTeam(req.user.id, parsed.data.name));
    } catch (error) {
      next(error);
    }
    },
  );

  router.get(
    "/teams/:teamId",
    requireAuth(authService),
    requireTeamRole(service),
    async (req, res, next) => {
      const teamId = req.team?.id;
      if (teamId === undefined) {
        next(new HttpError(401, "Unauthorized"));
        return;
      }

      try {
        res.json(await service.getTeam(teamId));
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/teams/:teamId/members",
    requireAuth(authService),
    requireTeamRole(service),
    async (req, res, next) => {
      const teamId = req.team?.id;
      if (teamId === undefined) {
        next(new HttpError(401, "Unauthorized"));
        return;
      }

      try {
        res.json(await service.getMembers(teamId));
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/teams/:teamId/members/:userId",
    requireAuth(authService),
    requireTeamRole(service, "owner"),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsedUser = userIdSchema.safeParse(req.params.userId);
      const parsedBody = changeRoleSchema.safeParse(req.body);
      if (teamId === undefined || !parsedUser.success || !parsedBody.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        await service.changeRole(teamId, parsedUser.data, parsedBody.data.role);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/teams/:teamId/members/:userId",
    requireAuth(authService),
    requireTeamRole(service, "owner"),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsedUser = userIdSchema.safeParse(req.params.userId);
      if (teamId === undefined || !parsedUser.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        await service.removeMember(teamId, parsedUser.data);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/teams/:teamId/invites",
    requireAuth(authService),
    requireTeamRole(service, "owner"),
    inviteCreateRateLimit(limiter),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsed = createInviteSchema.safeParse(req.body);
      if (req.user === undefined || teamId === undefined || !parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.status(201).json(
          await service.createInvite(
            teamId,
            req.user.id,
            parsed.data.email ?? null,
            parsed.data.role,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/teams/:teamId/invites",
    requireAuth(authService),
    requireTeamRole(service, "owner"),
    async (req, res, next) => {
      const teamId = req.team?.id;
      if (teamId === undefined) {
        next(new HttpError(401, "Unauthorized"));
        return;
      }

      try {
        res.json(await service.listInvites(teamId));
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/teams/:teamId/invites/:inviteId",
    requireAuth(authService),
    requireTeamRole(service, "owner"),
    async (req, res, next) => {
      const teamId = req.team?.id;
      const parsedInvite = inviteIdSchema.safeParse(req.params.inviteId);
      if (teamId === undefined || !parsedInvite.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        await service.revokeInvite(teamId, parsedInvite.data);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/invites/accept",
    requireAuth(authService),
    inviteAcceptRateLimit(limiter),
    async (req, res, next) => {
      const parsed = acceptInviteSchema.safeParse(req.body);
      if (req.user === undefined || !parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.status(201).json(
          await service.acceptInvite(
            req.user.id,
            req.user.email,
            parsed.data.token,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
