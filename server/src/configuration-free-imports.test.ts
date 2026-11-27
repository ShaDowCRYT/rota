import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const settings = [
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "SENTRY_DSN",
  "GOOGLE_WEB_CLIENT_ID",
  "TRUST_PROXY_HOPS",
  "FLUTTERWAVE_SECRET_KEY",
  "FLUTTERWAVE_SECRET_HASH",
  "BILLING_CURRENCY",
  "PUBLIC_API_URL",
  "RUN_WORKER",
] as const;

const saved = new Map<string, string | undefined>();
const srcRoot = dirname(fileURLToPath(import.meta.url));

const modules = [
  "app.ts",
  "jobs/billingQueue.ts",
  "jobs/billingQueueAdapter.ts",
  "lib/errors.ts",
  "lib/logger.ts",
  "lib/opaqueToken.ts",
  "lib/password.ts",
  "lib/refreshToken.ts",
  "lib/redis.ts",
  "lib/sentry.ts",
  "lib/time.ts",
  "lib/tokens.ts",
  "middleware/auth.ts",
  "middleware/errorHandler.ts",
  "middleware/rateLimit.ts",
  "middleware/teamRole.ts",
  "db/client.ts",
  "db/shard.ts",
  "db/transaction.ts",
  "db/types.ts",
  "db/schema/global.ts",
  "db/schema/shard.ts",
  "providers/email.ts",
  "providers/payments/flutterwave.ts",
  "providers/payments/types.ts",
  "modules/activity/repository.ts",
  "modules/activity/routes.ts",
  "modules/activity/schema.ts",
  "modules/activity/service.ts",
  "modules/activity/types.ts",
  "modules/auth/googleService.ts",
  "modules/auth/repository.ts",
  "modules/auth/resetRepository.ts",
  "modules/auth/resetService.ts",
  "modules/auth/resetTypes.ts",
  "modules/auth/routes.ts",
  "modules/auth/schema.ts",
  "modules/auth/service.ts",
  "modules/auth/types.ts",
  "modules/billing/checkoutSchema.ts",
  "modules/billing/idempotency.ts",
  "modules/billing/idempotencyRepository.ts",
  "modules/billing/paymentRepository.ts",
  "modules/billing/proration.ts",
  "modules/billing/recovery.ts",
  "modules/billing/repository.ts",
  "modules/billing/routes.ts",
  "modules/billing/schema.ts",
  "modules/billing/service.ts",
  "modules/billing/types.ts",
  "modules/billing/webhook.ts",
  "modules/billing/worker.ts",
  "modules/shifts/repository.ts",
  "modules/shifts/routes.ts",
  "modules/shifts/schema.ts",
  "modules/shifts/service.ts",
  "modules/shifts/types.ts",
  "modules/swaps/repository.ts",
  "modules/swaps/routes.ts",
  "modules/swaps/schema.ts",
  "modules/swaps/service.ts",
  "modules/swaps/types.ts",
  "modules/teams/repository.ts",
  "modules/teams/routes.ts",
  "modules/teams/schema.ts",
  "modules/teams/seats.ts",
  "modules/teams/service.ts",
  "modules/teams/types.ts",
].map((file) => join(srcRoot, file));

describe("configuration-free imports", () => {
  beforeAll(() => {
    for (const name of settings) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterAll(() => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("every listed module imports without configuration", async () => {
    expect(modules.length).toBeGreaterThan(0);

    for (const file of modules) {
      const imported = await import(pathToFileURL(file).href);
      expect(imported).toBeDefined();
    }
  }, 30_000);
});
