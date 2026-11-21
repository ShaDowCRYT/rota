import type { Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { createTokenIssuer } from "../lib/tokens.js";
import {
  createFakePasswords,
  FakeAuthRepository,
  FakeRedis,
  startServer,
  testRefreshTtlDays,
  testTokenConfig,
} from "../test/helpers.js";
import { createAuthService } from "../modules/auth/service.js";
import {
  createRedisFixedWindowLimiter,
  emailRateKey,
  type RedisLike,
} from "./rateLimit.js";

const password = "correct horse battery staple";

function setup() {
  const repository = new FakeAuthRepository();
  const authService = createAuthService({
    repository,
    passwords: createFakePasswords(),
    tokens: createTokenIssuer(testTokenConfig),
    refreshTtlDays: testRefreshTtlDays,
  });
  const redis = new FakeRedis();
  const app = createApp({
    checkDatabase: () => Promise.resolve(),
    checkRedis: () => Promise.resolve(true),
    authService,
    limiter: createRedisFixedWindowLimiter(redis),
  });

  return { app, redis };
}

async function post(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("redis fixed-window limiter", () => {
  it("INCRs each hit and EXPIREs only the first hit", async () => {
    const redis = new FakeRedis();
    const limiter = createRedisFixedWindowLimiter(redis);

    await limiter.consume("key", 2, 60);
    await limiter.consume("key", 2, 60);

    expect(redis.incrCalls).toBe(2);
    expect(redis.expireCalls).toBe(1);
    expect(redis.expiryFor("key")).toBe(60);
  });

  it("the request after the limit returns 429 with Retry-After", async () => {
    const redis = new FakeRedis();
    const limiter = createRedisFixedWindowLimiter(redis);

    await limiter.consume("key", 1, 60);
    await expect(limiter.consume("key", 1, 60)).rejects.toMatchObject({
      status: 429,
      headers: { "Retry-After": "60" },
    });
  });

  it("a fake Redis failure results in 503 and logs the real error", async () => {
    const failingRedis: RedisLike = {
      async incr() {
        throw new Error("redis connection refused");
      },
      async expire() {
        return 1;
      },
    };
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      await expect(
        createRedisFixedWindowLimiter(failingRedis).consume("key", 5, 60),
      ).rejects.toMatchObject({ status: 503, message: "Service unavailable" });
      expect(write.mock.calls.some((call) => String(call[0]).includes("redis connection refused"))).toBe(true);
    } finally {
      write.mockRestore();
    }
  });
});

describe("endpoint rate limits", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    await closeServer(running);
  });

  it("signup allows 5 requests per hour per IP then returns 429", async () => {
    const { app, redis } = setup();
    const started = await startServer(app);
    server = started.server;

    for (let index = 0; index < 5; index += 1) {
      const response = await post(started.baseUrl, "/auth/signup", {
        email: `user${index}@example.com`,
        password,
      });
      expect(response.status).toBe(201);
    }

    const blocked = await post(started.baseUrl, "/auth/signup", {
      email: "sixth@example.com",
      password,
    });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect(await blocked.json()).toEqual({ error: "Too many requests" });
    expect(redis.keys()).toHaveLength(1);
    expect(redis.expiryFor(redis.keys()[0] ?? "")).toBe(3600);
    expect(redis.incrCalls).toBe(6);
    expect(redis.expireCalls).toBe(1);
  });

  it("login limits 5 attempts per 15 minutes per hashed email", async () => {
    const { app, redis } = setup();
    const started = await startServer(app);
    server = started.server;
    await post(started.baseUrl, "/auth/signup", {
      email: "user@example.com",
      password,
    });

    for (let index = 0; index < 5; index += 1) {
      const response = await post(started.baseUrl, "/auth/login", {
        email: "USER@EXAMPLE.COM",
        password: "wrong password value",
      });
      expect(response.status).toBe(401);
    }

    const blocked = await post(started.baseUrl, "/auth/login", {
      email: "user@example.com",
      password,
    });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
    const emailKey = `rl:login:email:${emailRateKey("user@example.com")}`;
    expect(redis.expiryFor(emailKey)).toBe(900);
    expect(JSON.stringify(redis.keys())).not.toContain("user@example.com");
  });

  it("redis unavailability returns 503 on signup", async () => {
    const { app, redis } = setup();
    const started = await startServer(app);
    server = started.server;
    redis.fail = true;

    const response = await post(started.baseUrl, "/auth/signup", {
      email: "user@example.com",
      password,
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Service unavailable" });
  });
});
