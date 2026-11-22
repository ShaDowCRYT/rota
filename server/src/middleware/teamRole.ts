import type { RequestHandler } from "express";

import { HttpError } from "../lib/errors.js";
import { teamIdSchema } from "../modules/teams/schema.js";
import type { Role, TeamsService } from "../modules/teams/types.js";

declare module "express-serve-static-core" {
  interface Request {
    team?: { id: string; role: Role };
  }
}

export function requireTeamRole(
  service: TeamsService,
  ...allowedRoles: Role[]
): RequestHandler {
  return async (req, _res, next) => {
    try {
      const parsed = teamIdSchema.safeParse(req.params.teamId);
      if (!parsed.success) {
        next(new HttpError(400, "Invalid team id"));
        return;
      }

      if (req.user === undefined) {
        next(new HttpError(401, "Unauthorized"));
        return;
      }

      const membership = await service.getMembership(parsed.data, req.user.id);
      if (membership === undefined) {
        next(new HttpError(404, "Team not found"));
        return;
      }

      if (
        allowedRoles.length > 0 &&
        !allowedRoles.includes(membership.role)
      ) {
        next(new HttpError(403, "Forbidden"));
        return;
      }

      req.team = { id: parsed.data, role: membership.role };
      next();
    } catch (error) {
      next(error);
    }
  };
}
