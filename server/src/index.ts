import * as Sentry from "@sentry/node";

import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { createDb } from "./db/client.js";
import { checkDatabase, closePool, getPool } from "./db/pool.js";
import { configureShards } from "./db/shard.js";
import { getErrorMessage } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { createPasswordService } from "./lib/password.js";
import { checkRedis, closeRedis, getRedis } from "./lib/redis.js";
import { initSentry } from "./lib/sentry.js";
import { createTokenIssuer } from "./lib/tokens.js";
import { errorHandler } from "./middleware/errorHandler.js";
import {
  createRedisFixedWindowLimiter,
  type RedisLike,
} from "./middleware/rateLimit.js";
import { createAuthRepository } from "./modules/auth/repository.js";
import { createPasswordResetRepository } from "./modules/auth/resetRepository.js";
import { createAuthService } from "./modules/auth/service.js";
import { createTeamsRepository } from "./modules/teams/repository.js";
import { createTeamsService } from "./modules/teams/service.js";
import { createDevEmailSender } from "./providers/email.js";

initSentry({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });

const database = createDb(getPool());
const redis = getRedis(env.REDIS_URL);
configureShards([database]);

const passwords = createPasswordService();
const authService = createAuthService({
  repository: createAuthRepository(database),
  passwords,
  tokens: createTokenIssuer({
    secret: env.JWT_ACCESS_SECRET,
    ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
  }),
  refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
});

const teamsService = createTeamsService({
  repository: createTeamsRepository(database),
  authService,
  inviteTtlDays: env.INVITE_TTL_DAYS,
});

const limiterRedis: RedisLike = {
  incr: (key) => redis.incr(key),
  expire: (key, seconds) => redis.expire(key, seconds),
  eval: (script, keys, args) =>
    redis.eval(script, keys.length, ...keys, ...args) as Promise<number>,
};

const app = createApp({
  checkDatabase,
  checkRedis: () => checkRedis(env.REDIS_URL),
  authService,
  limiter: createRedisFixedWindowLimiter(limiterRedis),
  teamsService,
  resetRepository: createPasswordResetRepository(database),
  passwords,
  emailSender: createDevEmailSender(env.NODE_ENV),
  resetTtlMinutes: env.RESET_TOKEN_TTL_MINUTES,
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
