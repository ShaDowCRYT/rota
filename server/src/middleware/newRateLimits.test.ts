import type { Server } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { createTokenIssuer } from "../lib/tokens.js";
import { createRedisFixedWindowLimiter, emailRateKey } from "../middleware/rateLimit.js";
import { createAuthService } from "../modules/auth/service.js";
import { createTeamsService } from "../modules/teams/service.js";
import {
  createFakePasswords,
  FakeAuthRepository,
  FakeEmailSender,
  FakePasswordResetRepository,
  FakeRedis,
  FakeTeamsRepository,
  startServer,
  testRefreshTtlDays,
  testResetTtlMinutes,
  testTokenConfig,
} from "../test/helpers.js";

const password = "correct horse battery staple";
const opaqueValue = "z".repeat(32);

function setup() {
  const repository = new FakeAuthRepository();
  const passwords = createFakePasswords();
  const tokens = createTokenIssuer(testTokenConfig);
  const authService = createAuthService({
    repository,
    passwords,
    tokens,
    refreshTtlDays: testRefreshTtlDays,
  });
  const teamsRepository = new FakeTeamsRepository();
  const teamsService = createTeamsService({
    repository: teamsRepository,
    authService,
    inviteTtlDays: 7,
  });
  const redis = new FakeRedis();
  const resetRepository = new FakePasswordResetRepository();
  const emailSender = new FakeEmailSender();

  const app = createApp({
    checkDatabase: () => Promise.resolve(),
    checkRedis: () => Promise.resolve(true),
    authService,
    limiter: createRedisFixedWindowLimiter(redis),
    teamsService,
    resetRepository,
    passwords,
    emailSender,
    resetTtlMinutes: testResetTtlMinutes,
  });

  return {
    app,
    redis,
    repository,
    passwords,
    tokens,
    teamsRepository,
  };
}

type Setup = ReturnType<typeof setup>;

async function addUser(env: Setup, email: string) {
  const user = await env.repository.createUser(
    email,
    await env.passwords.hash(password),
  );
  const accessToken = await env.tokens.sign(user.id);
  return { userId: user.id, accessToken };
}

async function post(
  baseUrl: string,
  path: string,
  body: unknown,
  accessToken?: string,
) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accessToken === undefined
        ? {}
        : { authorization: `Bearer ${accessToken}` }),
    },
    body: JSON.stringify(body),
  });
}

describe("new Redis rate limits", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("invite creation allows 30 per hour per user then returns 429", async () => {
    const env = setup();
    const started = await startServer(env.app);
    server = started.server;

    const { userId, accessToken } = await addUser(env, "owner@example.com");
    const team = await env.teamsRepository.createTeamWithOwner(
      userId,
      "Owner team",
    );

    for (let index = 0; index < 30; index += 1) {
      const response = await post(
        started.baseUrl,
        `/teams/${team.id}/invites`,
        { role: "staff" },
        accessToken,
      );
      expect(response.status).toBe(201);
    }

    const blocked = await post(
      started.baseUrl,
      `/teams/${team.id}/invites`,
      { role: "staff" },
      accessToken,
    );

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect(await blocked.json()).toEqual({ error: "Too many requests" });
    expect(env.redis.keys()).toEqual([
      `rl:invite:create:user:${userId}`,
    ]);
    expect(env.redis.expiryFor(`rl:invite:create:user:${userId}`)).toBe(3600);
    expect(env.redis.incrCalls).toBe(31);
    expect(env.redis.expireCalls).toBe(1);
  });

  it("invite acceptance allows 20 per 15 minutes per IP then returns 429", async () => {
    const env = setup();
    const started = await startServer(env.app);
    server = started.server;

    const first = await addUser(env, "first@example.com");
    const second = await addUser(env, "second@example.com");

    for (let index = 0; index < 20; index += 1) {
      const accessToken = index % 2 === 0 ? first.accessToken : second.accessToken;
      const response = await post(
        started.baseUrl,
        "/invites/accept",
        { token: opaqueValue },
        accessToken,
      );
      expect(response.status).toBe(400);
    }

    const blocked = await post(
      started.baseUrl,
      "/invites/accept",
      { token: opaqueValue },
      first.accessToken,
    );

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
    expect(await blocked.json()).toEqual({ error: "Too many requests" });
    const keys = env.redis.keys();
    expect(keys).toHaveLength(1);
    const [key] = keys;
    expect(key).toMatch(/^rl:invite:accept:ip:/);
    expect(key).not.toContain(first.userId);
    expect(key).not.toContain(second.userId);
    expect(env.redis.expiryFor(key ?? "")).toBe(900);
  });

  it("forgot password allows 5 per hour per IP then returns 429", async () => {
    const env = setup();
    const started = await startServer(env.app);
    server = started.server;

    for (let index = 0; index < 5; index += 1) {
      const response = await post(started.baseUrl, "/auth/forgot", {
        email: `forgot${index}@example.com`,
      });
      expect(response.status).toBe(202);
    }

    const blocked = await post(started.baseUrl, "/auth/forgot", {
      email: "sixth@example.com",
    });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect(await blocked.json()).toEqual({ error: "Too many requests" });
    const [ipKey] = env
      .redis
      .keys()
      .filter((key) => key.startsWith("rl:forgot:ip:"));
    expect(ipKey).toBeDefined();
    expect(env.redis.expiryFor(ipKey ?? "")).toBe(3600);
  });

  it("forgot password allows 3 per hour per hashed email without storing the raw email", async () => {
    const env = setup();
    const started = await startServer(env.app);
    server = started.server;

    const email = "Forgot@Example.COM";

    for (let index = 0; index < 3; index += 1) {
      const response = await post(started.baseUrl, "/auth/forgot", { email });
      expect(response.status).toBe(202);
    }

    const blocked = await post(started.baseUrl, "/auth/forgot", { email });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect(await blocked.json()).toEqual({ error: "Too many requests" });
    const emailKey = `rl:forgot:email:${emailRateKey(email)}`;
    expect(env.redis.expiryFor(emailKey)).toBe(3600);
    expect(emailKey.slice("rl:forgot:email:".length)).toMatch(
      /^[a-f0-9]{64}$/,
    );
    const serializedKeys = JSON.stringify(env.redis.keys());
    expect(serializedKeys).not.toContain(email);
    expect(serializedKeys).not.toContain(email.toLowerCase());
  });

  it("reset allows 10 per 15 minutes per IP then returns 429", async () => {
    const env = setup();
    const started = await startServer(env.app);
    server = started.server;

    for (let index = 0; index < 10; index += 1) {
      const response = await post(started.baseUrl, "/auth/reset", {
        token: opaqueValue,
        newPassword: password,
      });
      expect(response.status).toBe(400);
    }

    const blocked = await post(started.baseUrl, "/auth/reset", {
      token: opaqueValue,
      newPassword: password,
    });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
    expect(await blocked.json()).toEqual({ error: "Too many requests" });
    const keys = env.redis.keys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^rl:reset:ip:/);
    expect(env.redis.expiryFor(keys[0] ?? "")).toBe(900);
  });

  it("a Redis failure on a new limit returns 503 without the underlying error", async () => {
    const env = setup();
    const started = await startServer(env.app);
    server = started.server;
    env.redis.fail = true;

    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let response: Response;
    try {
      response = await post(started.baseUrl, "/auth/reset", {
        token: opaqueValue,
        newPassword: password,
      });
    } finally {
      write.mockRestore();
    }

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Service unavailable" });
  });
});
