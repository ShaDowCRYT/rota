import { randomUUID } from "node:crypto";

import express, { type Express } from "express";

import { getErrorMessage } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import type { RateLimiter } from "./middleware/rateLimit.js";
import { createAuthRouter } from "./modules/auth/routes.js";
import type { AuthService } from "./modules/auth/service.js";

export type DatabaseCheck = () => Promise<void>;
export type RedisCheck = () => Promise<boolean>;

export interface AppDependencies {
  checkDatabase: DatabaseCheck;
  checkRedis: RedisCheck;
  authService: AuthService;
  limiter: RateLimiter;
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

  app.use(createAuthRouter(deps.authService, deps.limiter));

  return app;
}
