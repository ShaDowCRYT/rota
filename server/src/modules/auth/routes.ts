import { Router } from "express";

import { HttpError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  forgotEmailRateLimit,
  forgotIpRateLimit,
  googleRateLimit,
  loginEmailRateLimit,
  loginIpRateLimit,
  refreshRateLimit,
  resetRateLimit,
  signupRateLimit,
  type RateLimiter,
} from "../../middleware/rateLimit.js";
import type { GoogleSignInService } from "./googleService.js";
import {
  credentialsSchema,
  forgotPasswordSchema,
  googleIdTokenSchema,
  refreshTokenSchema,
  resetPasswordSchema,
} from "./schema.js";
import type { ResetService } from "./resetService.js";
import type { AuthService } from "./service.js";

export function createAuthRouter(
  service: AuthService,
  resetService: ResetService,
  limiter: RateLimiter,
  googleService: GoogleSignInService,
): Router {
  const router = Router();

  router.post(
    "/auth/signup",
    signupRateLimit(limiter),
    async (req, res, next) => {
      const parsed = credentialsSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.status(201).json(await service.signup(parsed.data.email, parsed.data.password));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/login",
    loginIpRateLimit(limiter),
    loginEmailRateLimit(limiter),
    async (req, res, next) => {
      const parsed = credentialsSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.json(await service.login(parsed.data.email, parsed.data.password));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/google",
    googleRateLimit(limiter),
    async (req, res, next) => {
      const parsed = googleIdTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.json(await googleService.signIn(parsed.data.idToken));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/refresh",
    refreshRateLimit(limiter),
    async (req, res, next) => {
      const parsed = refreshTokenSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        res.json(await service.refresh(parsed.data.refreshToken));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post("/auth/logout", async (req, res, next) => {
    const parsed = refreshTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new HttpError(400, "Invalid request"));
      return;
    }

    try {
      await service.logout(parsed.data.refreshToken);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/auth/logout-all",
    requireAuth(service),
    async (req, res, next) => {
      if (req.user === undefined) {
        next(new HttpError(401, "Unauthorized"));
        return;
      }

      try {
        await service.logoutAll(req.user.id);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/forgot",
    forgotIpRateLimit(limiter),
    forgotEmailRateLimit(limiter),
    async (req, res, next) => {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        await resetService.requestReset(parsed.data.email);
        res.status(202).json({
          message: "If that email exists, a reset link has been sent.",
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/auth/reset",
    resetRateLimit(limiter),
    async (req, res, next) => {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }

      try {
        await resetService.reset(parsed.data.token, parsed.data.newPassword);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/me", requireAuth(service), (req, res, next) => {
    if (req.user === undefined) {
      next(new HttpError(401, "Unauthorized"));
      return;
    }

    res.json({ id: req.user.id, email: req.user.email });
  });

  return router;
}
