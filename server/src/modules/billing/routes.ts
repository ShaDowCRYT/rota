import { Router } from "express";

import { HttpError } from "../../lib/errors.js";
import { requireAuth } from "../../middleware/auth.js";
import { billingCheckoutRateLimit, billingQuoteRateLimit, type RateLimiter } from "../../middleware/rateLimit.js";
import { requireTeamRole } from "../../middleware/teamRole.js";
import type { AuthService } from "../auth/service.js";
import type { TeamsService } from "../teams/types.js";
import { quoteRequestSchema } from "./schema.js";
import {
  checkoutRequestSchema,
  idempotencyKeyHeaderSchema,
  renewalCheckoutRequestSchema,
  scheduleChangeRequestSchema,
} from "./checkoutSchema.js";
import { toHttpError } from "./proration.js";
import type { BillingService } from "./types.js";

export function createBillingRouter(
  authService: AuthService,
  service: BillingService,
  teamsService: TeamsService,
  limiter: RateLimiter,
  options: { paymentsEnabled: boolean },
): Router {
  const router = Router();

  function requirePayments(next: (err?: unknown) => void): boolean {
    if (!options.paymentsEnabled) {
      next(new HttpError(503, "Payments are not available"));
      return false;
    }
    return true;
  }

  router.get(
    "/teams/:teamId/billing",
    requireAuth(authService),
    requireTeamRole(teamsService),
    async (req, res, next) => {
      if (!requirePayments(next)) return;
      const teamId = req.team?.id;
      if (teamId === undefined) {
        next(new HttpError(401, "Unauthorized"));
        return;
      }
      try {
        res.json(await service.getStatus(teamId, req.team?.role));
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
      if (!requirePayments(next)) return;
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
      if (!requirePayments(next)) return;
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

  router.post(
    "/teams/:teamId/billing/checkout",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner"),
    billingCheckoutRateLimit(limiter),
    async (req, res, next) => {
      if (!requirePayments(next)) return;
      const teamId = req.team?.id;
      const userId = req.user?.id;
      const email = req.user?.email;
      const keyParsed = idempotencyKeyHeaderSchema.safeParse(req.header("idempotency-key"));
      const bodyParsed = checkoutRequestSchema.safeParse(req.body);
      if (teamId === undefined || userId === undefined || email === undefined || !keyParsed.success || !bodyParsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }
      try {
        res.json(await service.checkout(teamId, userId, email, keyParsed.data, bodyParsed.data));
      } catch (error) {
        next(toHttpError(error) ?? error);
      }
    },
  );

  router.post(
    "/teams/:teamId/billing/schedule-change",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner"),
    billingCheckoutRateLimit(limiter),
    async (req, res, next) => {
      if (!requirePayments(next)) return;
      const teamId = req.team?.id;
      const userId = req.user?.id;
      const keyParsed = idempotencyKeyHeaderSchema.safeParse(req.header("idempotency-key"));
      const bodyParsed = scheduleChangeRequestSchema.safeParse(req.body);
      if (teamId === undefined || userId === undefined || !keyParsed.success || !bodyParsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }
      try {
        res.json(await service.scheduleChange(teamId, userId, keyParsed.data, bodyParsed.data));
      } catch (error) {
        next(toHttpError(error) ?? error);
      }
    },
  );

  router.post(
    "/teams/:teamId/billing/renewal-checkout",
    requireAuth(authService),
    requireTeamRole(teamsService, "owner"),
    billingCheckoutRateLimit(limiter),
    async (req, res, next) => {
      if (!requirePayments(next)) return;
      const teamId = req.team?.id;
      const email = req.user?.email;
      const parsed = renewalCheckoutRequestSchema.safeParse(req.body);
      if (teamId === undefined || email === undefined || !parsed.success) {
        next(new HttpError(400, "Invalid request"));
        return;
      }
      try {
        res.json(await service.createRenewalCheckout(teamId, parsed.data.paymentId, email));
      } catch (error) {
        next(toHttpError(error) ?? error);
      }
    },
  );

  router.get("/billing/return", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment processing</title></head>
<body style="font-family:sans-serif;padding:24px;line-height:1.5">
  <h1>Payment being processed</h1>
  <p>Your payment is being checked. You can return to the app.</p>
  <p><a href="rota://billing">Open Rota</a></p>
</body></html>`);
  });

  return router;
}
