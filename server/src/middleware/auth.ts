import type { RequestHandler } from "express";

import { HttpError } from "../lib/errors.js";
import type { AuthService } from "../modules/auth/service.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: { id: string; email: string };
  }
}

export function requireAuth(service: AuthService): RequestHandler {
  return async (req, _res, next) => {
    const header = req.header("authorization");

    if (header === undefined || !header.startsWith("Bearer ")) {
      next(new HttpError(401, "Unauthorized"));
      return;
    }

    const token = header.slice("Bearer ".length).trim();
    const userId = token.length === 0 ? undefined : await service.verifyAccessToken(token);

    if (userId === undefined) {
      next(new HttpError(401, "Unauthorized"));
      return;
    }

    const user = await service.loadUserById(userId);

    if (user === undefined) {
      next(new HttpError(401, "Unauthorized"));
      return;
    }

    req.user = user;
    next();
  };
}
