import { randomUUID } from "node:crypto";

import express, { type Express } from "express";
import type { JWTVerifyGetKey } from "jose";

import { getErrorMessage } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import type { RateLimiter } from "./middleware/rateLimit.js";
import type { EmailSender } from "./providers/email.js";
import { createActivityRouter } from "./modules/activity/routes.js";
import type { ActivityService } from "./modules/activity/types.js";
import { createGoogleSignInService } from "./modules/auth/googleService.js";
import { createAuthRouter } from "./modules/auth/routes.js";
import { createResetService } from "./modules/auth/resetService.js";
import type { PasswordResetRepository } from "./modules/auth/resetTypes.js";
import type { AuthService } from "./modules/auth/service.js";
import type { PasswordService } from "./modules/auth/types.js";
import { createShiftsRouter } from "./modules/shifts/routes.js";
import type { ShiftsService } from "./modules/shifts/types.js";
import { createSwapsRouter } from "./modules/swaps/routes.js";
import type { SwapsService } from "./modules/swaps/types.js";
import { createTeamsRouter } from "./modules/teams/routes.js";
import type { TeamsService } from "./modules/teams/types.js";
import { createBillingRouter } from "./modules/billing/routes.js";
import { createBillingWebhookRouter } from "./modules/billing/webhook.js";
import type { BillingService } from "./modules/billing/types.js";
import type { PaymentProvider } from "./providers/payments/types.js";
import type { BillingQueue } from "./jobs/billingQueueAdapter.js";

export type DatabaseCheck = () => Promise<void>;
export type RedisCheck = () => Promise<boolean>;

export interface AppDependencies {
  checkDatabase: DatabaseCheck;
  checkRedis: RedisCheck;
  authService: AuthService;
  limiter: RateLimiter;
  teamsService: TeamsService;
  billingService: BillingService;
  activityService: ActivityService;
  shiftsService: ShiftsService;
  swapsService: SwapsService;
  resetRepository: PasswordResetRepository;
  passwords: PasswordService;
  emailSender: EmailSender;
  resetTtlMinutes: number;
  trustProxyHops: number;
  googleAudience?: string;
  googleJwks?: JWTVerifyGetKey;
  paymentProvider?: PaymentProvider;
  paymentsEnabled?: boolean;
  billingQueue?: BillingQueue;
}

async function runCheck(
  name: "database" | "redis",
  check: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await check();
  } catch (error) {
    logger.error(`${name} readiness check failed`, {
      error: getErrorMessage(error),
    });
    return false;
  }
}

export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  if (deps.trustProxyHops > 0) {
    app.set("trust proxy", deps.trustProxyHops);
  }

  if (deps.paymentProvider !== undefined && deps.billingQueue !== undefined) {
    app.use(
      "/webhooks/flutterwave",
      createBillingWebhookRouter({
        provider: deps.paymentProvider,
        queue: deps.billingQueue,
        limiter: deps.limiter,
      }),
    );
  }

  app.use(express.json({ limit: "10kb" }));

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = Date.now();

    res.on("finish", () => {
      logger.info("request completed", {
        requestId,
        userId: req.user?.id ?? null,
        route: req.route?.path ?? req.path,
        durationMs: Date.now() - startedAt,
        status: res.statusCode,
      });
    });

    next();
  });

  const checkDatabaseReady = async (): Promise<boolean> => {
    await deps.checkDatabase();
    return true;
  };

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/health/ready", async (_req, res) => {
    const [databaseOk, redisOk] = await Promise.all([
      runCheck("database", checkDatabaseReady),
      runCheck("redis", deps.checkRedis),
    ]);

    const dependencies = {
      database: databaseOk ? "ok" : "unavailable",
      redis: redisOk ? "ok" : "unavailable",
    } as const;

    if (databaseOk && redisOk) {
      res.json({ status: "ok", ...dependencies });
      return;
    }

    res.status(503).json({ status: "error", ...dependencies });
  });

  const resetService = createResetService({
    repository: deps.resetRepository,
    authService: deps.authService,
    passwords: deps.passwords,
    emailSender: deps.emailSender,
    ttlMinutes: deps.resetTtlMinutes,
  });

  const googleService = createGoogleSignInService({
    authService: deps.authService,
    audience: deps.googleAudience,
    jwks: deps.googleJwks,
  });

  app.use(
    createAuthRouter(deps.authService, resetService, deps.limiter, googleService),
  );
  app.use(createTeamsRouter(deps.authService, deps.teamsService, deps.limiter));
  app.use(
    createBillingRouter(
      deps.authService,
      deps.billingService,
      deps.teamsService,
      deps.limiter,
      { paymentsEnabled: deps.paymentsEnabled ?? false },
    ),
  );
  app.use(
    createActivityRouter(
      deps.authService,
      deps.activityService,
      deps.teamsService,
      deps.limiter,
    ),
  );
  app.use(
    createShiftsRouter(
      deps.authService,
      deps.shiftsService,
      deps.teamsService,
      deps.limiter,
    ),
  );
  app.use(
    createSwapsRouter(
      deps.authService,
      deps.swapsService,
      deps.teamsService,
      deps.limiter,
    ),
  );

  return app;
}
