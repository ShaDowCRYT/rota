import express, { type Express } from "express";

import { getErrorMessage } from "./lib/errors.js";
import { logger } from "./lib/logger.js";

export type DatabaseCheck = () => Promise<void>;
export type RedisCheck = () => Promise<boolean>;

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

export function createApp(
  checkDatabase: DatabaseCheck,
  checkRedis: RedisCheck,
): Express {
  const app = express();

  const checkDatabaseReady = async (): Promise<boolean> => {
    await checkDatabase();
    return true;
  };

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/health/ready", async (_req, res) => {
    const [databaseOk, redisOk] = await Promise.all([
      runCheck("database", checkDatabaseReady),
      runCheck("redis", checkRedis),
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

  return app;
}
