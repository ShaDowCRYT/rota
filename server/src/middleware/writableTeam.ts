import type { RequestHandler } from "express";

import { HttpError } from "../lib/errors.js";
import type { BillingService } from "../modules/billing/types.js";

export function requireWritableTeam(service: BillingService): RequestHandler {
  return async (req, _res, next) => {
    try {
      const teamId = req.team?.id;
      if (teamId === undefined) {
        next(new HttpError(401, "Unauthorized"));
        return;
      }
      await service.assertTeamWritable(teamId);
      next();
    } catch (error) {
      next(error);
    }
  };
}
