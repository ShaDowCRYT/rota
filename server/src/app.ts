import express, { type Express } from "express";

import { getErrorMessage } from "./lib/errors.js";
import { logger } from "./lib/logger.js";

export type DatabaseCheck = () => Promise<void>;

export function createApp(checkDatabase: DatabaseCheck): Express {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/health/ready", async (_req, res) => {
    try {
      await checkDatabase();
      res.json({ status: "ok", database: "ok" });
    } catch (error) {
      logger.error("database readiness check failed", {
        error: getErrorMessage(error),
      });
      res.status(503).json({ status: "error", database: "unavailable" });
    }
  });

  return app;
}
