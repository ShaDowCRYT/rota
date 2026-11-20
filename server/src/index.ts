import * as Sentry from "@sentry/node";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { checkDatabase, closePool } from "./db/pool.js";
import { getErrorMessage } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { createPasswordService } from "./lib/password.js";
import { checkRedis, closeRedis, getRedis } from "./lib/redis.js";
import { initSentry } from "./lib/sentry.js";
import { createTokenIssuer } from "./lib/tokens.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { createRedisFixedWindowLimiter } from "./middleware/rateLimit.js";
import { createAuthRepository } from "./modules/auth/repository.js";
import { createAuthService } from "./modules/auth/service.js";

initSentry({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });

const authService = createAuthService({
  repository: createAuthRepository(),
  passwords: createPasswordService(),
  tokens: createTokenIssuer({
    secret: env.JWT_ACCESS_SECRET,
    ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  }),
});

const app = createApp({
  checkDatabase,
  checkRedis,
  authService,
  limiter: createRedisFixedWindowLimiter(getRedis()),
});

Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  logger.info("server listening", { port: env.PORT });
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info("shutdown requested", { signal });

  let exitCode = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    logger.error("failed to close http server", {
      error: getErrorMessage(error),
    });
    exitCode = 1;
  }

  try {
    await closeRedis();
  } catch (error) {
    logger.error("failed to close redis", {
      error: getErrorMessage(error),
    });
    exitCode = 1;
  }

  try {
    await closePool();
  } catch (error) {
    logger.error("failed to close database pool", {
      error: getErrorMessage(error),
    });
    exitCode = 1;
  }

  process.exit(exitCode);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
