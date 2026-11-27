import * as Sentry from "@sentry/node";
import { createRemoteJWKSet } from "jose";

import { createApp } from "./app.js";
import { env, paymentsEnabled } from "./config/env.js";
import { createDb } from "./db/client.js";
import { checkDatabase, closePool, getPool } from "./db/pool.js";
import { configureShards } from "./db/shard.js";
import { runShardTransaction } from "./db/transaction.js";
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
import { createActivityRepository } from "./modules/activity/repository.js";
import { createActivityService } from "./modules/activity/service.js";
import { createAuthRepository } from "./modules/auth/repository.js";
import { createPasswordResetRepository } from "./modules/auth/resetRepository.js";
import { createAuthService } from "./modules/auth/service.js";
import { createShiftsRepository } from "./modules/shifts/repository.js";
import { createShiftsService } from "./modules/shifts/service.js";
import { createSwapsRepository } from "./modules/swaps/repository.js";
import { createSwapsService } from "./modules/swaps/service.js";
import { createTeamsRepository } from "./modules/teams/repository.js";
import { createTeamsService } from "./modules/teams/service.js";
import { configureSeatLimitService } from "./modules/teams/seats.js";
import { createBillingRepository } from "./modules/billing/repository.js";
import { createBillingService } from "./modules/billing/service.js";
import { createIdempotencyRepository } from "./modules/billing/idempotencyRepository.js";
import { createPaymentRepository } from "./modules/billing/paymentRepository.js";
import { createDevEmailSender } from "./providers/email.js";
import { createFlutterwaveProvider } from "./providers/payments/flutterwave.js";
import { createBillingQueue, createBillingWorker } from "./jobs/billingQueue.js";
import { createBillingQueueAdapter } from "./jobs/billingQueueAdapter.js";
import { createBillingWebhookWorker } from "./modules/billing/worker.js";
import { reenqueueUnprocessedWebhookEvents } from "./modules/billing/recovery.js";

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

const paymentProvider =
  paymentsEnabled && env.FLUTTERWAVE_SECRET_KEY && env.FLUTTERWAVE_SECRET_HASH
    ? createFlutterwaveProvider({
        secretKey: env.FLUTTERWAVE_SECRET_KEY,
        secretHash: env.FLUTTERWAVE_SECRET_HASH,
      })
    : undefined;

const billingQueueRuntime =
  paymentsEnabled && env.REDIS_URL ? createBillingQueue({ redisUrl: env.REDIS_URL }) : undefined;
const billingQueue = billingQueueRuntime ? createBillingQueueAdapter(billingQueueRuntime) : undefined;

const activityService = createActivityService(createActivityRepository());
const billingService = createBillingService({
  repository: createBillingRepository(database),
  paymentRepository: createPaymentRepository(),
  idempotencyRepository: createIdempotencyRepository(),
  globalDb: database,
  provider: paymentProvider,
  paymentsEnabled,
  currency: env.BILLING_CURRENCY,
  publicApiUrl: env.PUBLIC_API_URL,
  transactions: runShardTransaction,
  now: () => new Date(),
  redis: {
    set: (key, value, mode, seconds, nx) => redis.set(key, value, mode, seconds, nx),
    eval: (script, keys, args) =>
      redis.eval(script, keys.length, ...keys, ...args) as Promise<unknown>,
  },
  activity: activityService,
});
configureSeatLimitService(billingService);

const shiftsService = createShiftsService({
  repository: createShiftsRepository(),
  activity: activityService,
  teamsService,
  transactions: runShardTransaction,
  now: () => new Date(),
});

const swapsService = createSwapsService({
  repository: createSwapsRepository(),
  activity: activityService,
  teamsService,
  transactions: runShardTransaction,
  now: () => new Date(),
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
  billingService,
  activityService,
  shiftsService,
  swapsService,
  resetRepository: createPasswordResetRepository(database),
  passwords,
  emailSender: createDevEmailSender(env.NODE_ENV),
  resetTtlMinutes: env.RESET_TOKEN_TTL_MINUTES,
  trustProxyHops: env.TRUST_PROXY_HOPS,
  googleAudience: env.GOOGLE_WEB_CLIENT_ID,
  googleJwks: createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
  ),
  paymentProvider,
  paymentsEnabled,
  billingQueue: billingQueue ?? undefined,
});

let billingWorker: ReturnType<typeof createBillingWorker> | undefined;
if (env.RUN_WORKER && paymentsEnabled && paymentProvider && env.REDIS_URL) {
  billingWorker = createBillingWorker(
    { redisUrl: env.REDIS_URL },
    createBillingWebhookWorker({
      provider: paymentProvider,
      repository: createBillingRepository(database),
      transactions: runShardTransaction,
      activity: activityService,
      currency: env.BILLING_CURRENCY,
      now: () => new Date(),
    }),
  );
  void reenqueueUnprocessedWebhookEvents(billingQueue!, 100).then((count) => {
    if (count > 0) logger.info("re-enqueued unprocessed billing webhooks", { count });
  });
}

Sentry.setupExpressErrorHandler(app);
app.use(errorHandler);

const server = app.listen(env.PORT, "0.0.0.0", () => {
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

  if (billingWorker !== undefined) {
    try {
      await billingWorker.close();
    } catch (error) {
      logger.error("failed to close billing worker", {
        error: getErrorMessage(error),
      });
      exitCode = 1;
    }
  }
  if (billingQueueRuntime !== undefined) {
    try {
      await billingQueueRuntime.close();
    } catch (error) {
      logger.error("failed to close billing queue", {
        error: getErrorMessage(error),
      });
      exitCode = 1;
    }
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
