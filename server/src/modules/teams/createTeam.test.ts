import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { createTokenIssuer } from "../../lib/tokens.js";
import {
  createFakePasswords,
  FakeAuthRepository,
  FakeRedis,
  FakeTeamsRepository,
  permissiveLimiter,
  startServer,
  testRefreshTtlDays,
  testResetTtlMinutes,
  testTokenConfig,
  unusedActivityService,
  unusedEmailSender,
  unusedPasswordResetRepository,
  unusedShiftsService,
  unusedSwapsService,
} from "../../test/helpers.js";
import { createRedisFixedWindowLimiter } from "../../middleware/rateLimit.js";
import { createAuthService } from "../auth/service.js";
import { createTeamsService } from "./service.js";
import { MAX_OWNED_TEAMS } from "./service.js";

function setup(limiter = permissiveLimiter) {
  const authRepository = new FakeAuthRepository();
  const teamsRepository = new FakeTeamsRepository();
  const passwords = createFakePasswords();
  const tokens = createTokenIssuer(testTokenConfig);
  const authService = createAuthService({
    repository: authRepository,
    passwords,
    tokens,
    refreshTtlDays: testRefreshTtlDays,
  });
  const teamsService = createTeamsService({
    repository: teamsRepository,
    authService,
    inviteTtlDays: 7,
  });
  const app = createApp({
    checkDatabase: () => Promise.resolve(),
    checkRedis: () => Promise.resolve(true),
    authService,
    limiter,
    teamsService,
    activityService: unusedActivityService,
    shiftsService: unusedShiftsService,
    swapsService: unusedSwapsService,
    resetRepository: unusedPasswordResetRepository,
    passwords,
    emailSender: unusedEmailSender,
    resetTtlMinutes: testResetTtlMinutes,
  });

  return { authRepository, teamsRepository, tokens, app };
}

type Context = ReturnType<typeof setup>;

async function createUser(context: Context, email: string) {
  const user = await context.authRepository.createUser(email, "fake:unused");
  return {
    id: user.id,
    email: user.email,
    token: await context.tokens.sign(user.id),
  };
}

async function postTeam(baseUrl: string, token: string, name = "Team") {
  return fetch(`${baseUrl}/teams`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
}

describe("POST /teams limits", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("rejects the 6th owned team with 409", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const owner = await createUser(context, "owner@example.com");

    for (let i = 0; i < MAX_OWNED_TEAMS; i += 1) {
      const response = await postTeam(started.baseUrl, owner.token, `Team ${i}`);
      expect(response.status).toBe(201);
    }

    const sixth = await postTeam(started.baseUrl, owner.token, "Team 6");
    expect(sixth.status).toBe(409);
    expect(await sixth.json()).toEqual({
      error: "You have reached the limit of 5 teams",
    });
  });

  it("allows creating a team when the user is only staff in other teams", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const owner = await createUser(context, "owner@example.com");
    const staffOnly = await createUser(context, "staff@example.com");

    for (let i = 0; i < MAX_OWNED_TEAMS; i += 1) {
      const response = await postTeam(started.baseUrl, owner.token, `Team ${i}`);
      expect(response.status).toBe(201);
      const team = (await response.json()) as { id: string };
      await context.teamsRepository.createMembership(team.id, staffOnly.id, "staff");
      await context.teamsRepository.addUserTeam(staffOnly.id, team.id);
    }

    const ownTeam = await postTeam(started.baseUrl, staffOnly.token, "My own team");
    expect(ownTeam.status).toBe(201);
  });

  it("counts only owned teams toward the limit", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const owner = await createUser(context, "owner@example.com");
    const otherOwner = await createUser(context, "other@example.com");

    for (let i = 0; i < MAX_OWNED_TEAMS; i += 1) {
      const response = await postTeam(started.baseUrl, owner.token, `Owned ${i}`);
      expect(response.status).toBe(201);
    }

    const otherTeam = await postTeam(started.baseUrl, otherOwner.token, "Other team");
    expect(otherTeam.status).toBe(201);
    const created = (await otherTeam.json()) as { id: string };
    await context.teamsRepository.createMembership(created.id, owner.id, "manager");
    await context.teamsRepository.addUserTeam(owner.id, created.id);

    const sixthOwned = await postTeam(started.baseUrl, owner.token, "Sixth owned");
    expect(sixthOwned.status).toBe(409);
    expect(await sixthOwned.json()).toEqual({
      error: "You have reached the limit of 5 teams",
    });
  });

  it("returns 429 with Retry-After when the per-user create limit is exceeded", async () => {
    const redis = new FakeRedis();
    const limiter = createRedisFixedWindowLimiter(redis);
    const context = setup(limiter);
    const started = await startServer(context.app);
    server = started.server;
    const owner = await createUser(context, "owner@example.com");

    for (let i = 0; i < MAX_OWNED_TEAMS; i += 1) {
      const response = await postTeam(started.baseUrl, owner.token, `Team ${i}`);
      expect(response.status).toBe(201);
    }
    for (let i = MAX_OWNED_TEAMS; i < 10; i += 1) {
      const response = await postTeam(started.baseUrl, owner.token, `Team ${i}`);
      expect(response.status).toBe(409);
    }

    const limited = await postTeam(started.baseUrl, owner.token, "Team 11");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("3600");
  });

  it("fails closed with 503 when Redis is down", async () => {
    const redis = new FakeRedis();
    redis.fail = true;
    const limiter = createRedisFixedWindowLimiter(redis);
    const context = setup(limiter);
    const started = await startServer(context.app);
    server = started.server;
    const owner = await createUser(context, "owner@example.com");

    const response = await postTeam(started.baseUrl, owner.token, "Team");
    expect(response.status).toBe(503);
  });
});
