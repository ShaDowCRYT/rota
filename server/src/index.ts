import express from "express";

import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(env.PORT, () => {
  logger.info("server listening", { port: env.PORT });
});
