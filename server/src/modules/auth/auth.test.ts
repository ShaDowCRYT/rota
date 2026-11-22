import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { SignJWT, decodeJwt } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { createRedisFixedWindowLimiter } from "../../middleware/rateLimit.js";
import {
  createFakePasswords,
  FakeAuthRepository,
  FakeRedis,
  startServer,
  testRefreshTtlDays,
  testResetTtlMinutes,
  testTokenConfig,
  unusedEmailSender,
  unusedPasswordResetRepository,
  unusedTeamsService,
} from "../../test/helpers.js";
import {
  generateRefreshToken,
  hashRefreshToken,
} from "../../lib/refreshToken.js";
import { createTokenIssuer } from "../../lib/tokens.js";
import { createAuthService } from "./service.js";
import type { RefreshTokenRecord } from "./types.js";

const credentials = {
  email: "User@Example.COM",
  password: "correct horse battery staple",
};

function setup(ttlSeconds = testTokenConfig.ttlSeconds) {
  const repository = new FakeAuthRepository();
  const passwords = createFakePasswords();
  const tokens = createTokenIssuer({ ...testTokenConfig, ttlSeconds });
  const authService = createAuthService({
    repository,
    passwords,
    tokens,
    refreshTtlDays: testRefreshTtlDays,
  });
  const redis = new FakeRedis();
  const app = createApp({
    checkDatabase: () => Promise.resolve(),
    checkRedis: () => Promise.resolve(true),
    authService,
    limiter: createRedisFixedWindowLimiter(redis),
    teamsService: unusedTeamsService,
    resetRepository: unusedPasswordResetRepository,
    passwords,
    emailSender: unusedEmailSender,
    resetTtlMinutes: testResetTtlMinutes,
  });

  return { repository, passwords, tokens, app, redis };
}

async function post(
  baseUrl: string,
  path: string,
  body: unknown,
  token?: string,
) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

async function get(baseUrl: string, path: string, token?: string) {
  return fetch(`${baseUrl}${path}`, {
    headers:
      token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
}

async function signup(baseUrl: string, email = credentials.email) {
  const response = await post(baseUrl, "/auth/signup", {
    email,
    password: credentials.password,
  });
  const body = (await response.json()) as {
    user: { id: string; email: string };
    accessToken: string;
    refreshToken: string;
  };
  return { response, body };
}

async function login(baseUrl: string) {
  const response = await post(baseUrl, "/auth/login", credentials);
  const body = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
  };
  return { response, body };
}

async function refresh(baseUrl: string, refreshToken: string) {
  return post(baseUrl, "/auth/refresh", { refreshToken });
}

function recordAt(
  repository: FakeAuthRepository,
  index: number,
): RefreshTokenRecord {
  const record = repository.refreshTokenRecords[index];
  if (record === undefined) {
    throw new Error("expected a refresh token record");
  }
  return record;
}

function encodePart(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const base64urlAlphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function splitToken(token: string): [string, string, string] {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("expected three jwt parts");
  }

  return parts as [string, string, string];
}

function tamperPayload(token: string): string {
  const [header, payload, signature] = splitToken(token);
  const index = Math.floor(payload.length / 2);
  const current = payload[index];
  if (current === undefined) {
    throw new Error("payload is empty");
  }

  const next =
    base64urlAlphabet[
      (base64urlAlphabet.indexOf(current) + 1) % base64urlAlphabet.length
    ];
  if (next === undefined) {
    throw new Error("alphabet is empty");
  }

  const changedPayload =
    payload.slice(0, index) + next + payload.slice(index + 1);
  return `${header}.${changedPayload}.${signature}`;
}

describe("auth endpoints", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("signup returns 201 without a password hash in the body", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;

    const response = await post(started.baseUrl, "/auth/signup", credentials);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(typeof body.accessToken).toBe("string");
    expect(JSON.stringify(body)).not.toContain("password_hash");
    expect(body.user).toEqual({
      id: expect.any(String),
      email: "user@example.com",
    });
  });

  it("signup stores the email in lowercase", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;

    await post(started.baseUrl, "/auth/signup", credentials);

    expect(repository.byEmail.has("user@example.com")).toBe(true);
    expect(repository.byEmail.has(credentials.email)).toBe(false);
  });

  it("duplicate email returns 409", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;

    const first = await post(started.baseUrl, "/auth/signup", credentials);
    const second = await post(started.baseUrl, "/auth/signup", {
      email: credentials.email.toUpperCase(),
      password: credentials.password,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "Email already in use" });
  });

  it("weak password and bad email return 400", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;

    const weak = await post(started.baseUrl, "/auth/signup", {
      email: "user@example.com",
      password: "short",
    });
    const badEmail = await post(started.baseUrl, "/auth/signup", {
      email: "not-an-email",
      password: credentials.password,
    });

    expect(weak.status).toBe(400);
    expect(badEmail.status).toBe(400);
    expect(await weak.json()).toEqual({ error: "Invalid request" });
    expect(await badEmail.json()).toEqual({ error: "Invalid request" });
  });

  it("login returns 200 for a valid password", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;
    await signup(started.baseUrl);

    const response = await post(started.baseUrl, "/auth/login", credentials);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(typeof body.accessToken).toBe("string");
    expect(JSON.stringify(body)).not.toContain("password_hash");
  });

  it("wrong password and unknown email return identical 401 bodies", async () => {
    const { app, passwords } = setup();
    const started = await startServer(app);
    server = started.server;
    await signup(started.baseUrl);

    const wrong = await post(started.baseUrl, "/auth/login", {
      email: "user@example.com",
      password: "wrong password value",
    });
    const unknown = await post(started.baseUrl, "/auth/login", {
      email: "nobody@example.com",
      password: "wrong password value",
    });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "Invalid email or password" });
    expect(await unknown.json()).toEqual({ error: "Invalid email or password" });
    expect(passwords.verifyCalls).toBe(2);
    expect(passwords.hashCalls).toBe(2);
  });

  it("unknown email twice creates the dummy hash only once", async () => {
    const { app, passwords } = setup();
    const started = await startServer(app);
    server = started.server;

    await post(started.baseUrl, "/auth/login", {
      email: "nobody@example.com",
      password: "wrong password value",
    });
    await post(started.baseUrl, "/auth/login", {
      email: "another@example.com",
      password: "wrong password value",
    });

    expect(passwords.hashCalls).toBe(1);
    expect(passwords.verifyCalls).toBe(2);
  });

  it("token contains no role or email", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);
    const payload = decodeJwt(body.accessToken);
    const user = repository.byEmail.get("user@example.com");

    expect(payload.sub).toBe(user?.id);
    expect(payload.iss).toBe("rota");
    expect(payload.aud).toBe("rota-app");
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("role");
  });

  it("a valid token returns 200 from /me", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);

    const response = await get(started.baseUrl, "/me", body.accessToken);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body.user);
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-jwt"],
  ])("%s token returns 401", async (_label, token) => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;

    const response = await get(started.baseUrl, "/me", token);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("a tampered token returns 401", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);
    const tampered = tamperPayload(body.accessToken);

    expect(tampered).not.toBe(body.accessToken);

    const response = await get(started.baseUrl, "/me", tampered);

    expect(response.status).toBe(401);
  });

  it("a token with a different user id in the payload returns 401", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);
    const [header, , signature] = splitToken(body.accessToken);
    const differentUserId = randomUUID();
    const changedPayload = encodePart({
      ...decodeJwt(body.accessToken),
      sub: differentUserId,
    });
    const tampered = `${header}.${changedPayload}.${signature}`;

    expect(tampered).not.toBe(body.accessToken);
    expect(decodeJwt(tampered).sub).toBe(differentUserId);

    const response = await get(started.baseUrl, "/me", tampered);

    expect(response.status).toBe(401);
  });

  it("a token with no signature returns 401", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);
    const [header, payload] = splitToken(body.accessToken);
    const tampered = `${header}.${payload}.`;

    expect(tampered).not.toBe(body.accessToken);
    expect(tampered.endsWith(".")).toBe(true);

    const response = await get(started.baseUrl, "/me", tampered);

    expect(response.status).toBe(401);
  });

  it("an expired token returns 401", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    await signup(started.baseUrl);
    const userId = repository.byEmail.get("user@example.com")?.id ?? "";
    const expired = await createTokenIssuer({
      ...testTokenConfig,
      ttlSeconds: -1,
    }).sign(userId);

    const response = await get(started.baseUrl, "/me", expired);

    expect(response.status).toBe(401);
  });

  it("a wrong-audience token returns 401", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    await signup(started.baseUrl);
    const userId = repository.byEmail.get("user@example.com")?.id ?? "";
    const now = Math.floor(Date.now() / 1000);
    const wrongAudience = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("rota")
      .setAudience("someone-else")
      .setSubject(userId)
      .setIssuedAt(now)
      .setExpirationTime(now + 900)
      .sign(new TextEncoder().encode(testTokenConfig.secret));

    const response = await get(started.baseUrl, "/me", wrongAudience);

    expect(response.status).toBe(401);
  });

  it("an alg none token returns 401", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    await signup(started.baseUrl);
    const userId = repository.byEmail.get("user@example.com")?.id ?? "";
    const now = Math.floor(Date.now() / 1000);
    const algNone = `${encodePart({ alg: "none", typ: "JWT" })}.${encodePart({
      iss: "rota",
      aud: "rota-app",
      sub: userId,
      iat: now,
      exp: now + 900,
    })}.`;

    const response = await get(started.baseUrl, "/me", algNone);

    expect(response.status).toBe(401);
  });

  it("a token for a deleted user returns 401", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);

    repository.byEmail.delete("user@example.com");

    const response = await get(started.baseUrl, "/me", body.accessToken);

    expect(response.status).toBe(401);
  });

  it("signup and login return a refresh token and store only its hash", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body: signedUp } = await signup(started.baseUrl);

    expect(signedUp.refreshToken.length).toBeGreaterThanOrEqual(20);
    expect(signedUp.refreshToken.length).toBeLessThanOrEqual(200);
    expect(recordAt(repository, 0).tokenHash).toBe(
      hashRefreshToken(signedUp.refreshToken),
    );
    expect(recordAt(repository, 0).tokenHash).not.toBe(signedUp.refreshToken);

    const { body: loggedIn } = await login(started.baseUrl);

    expect(loggedIn.refreshToken).not.toBe(signedUp.refreshToken);
    expect(repository.refreshTokenRecords).toHaveLength(2);
    expect(recordAt(repository, 1).tokenHash).toBe(
      hashRefreshToken(loggedIn.refreshToken),
    );
    expect(recordAt(repository, 1).familyId).not.toBe(
      recordAt(repository, 0).familyId,
    );
  });

  it("refresh returns a new pair, marks the old token used and keeps the family", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);
    const oldRecord = recordAt(repository, 0);

    const response = await refresh(started.baseUrl, body.refreshToken);
    const pair = (await response.json()) as {
      accessToken: string;
      refreshToken: string;
    };

    expect(response.status).toBe(200);
    expect(typeof pair.accessToken).toBe("string");
    expect(pair.refreshToken).not.toBe(body.refreshToken);
    expect(oldRecord.usedAt).toBeInstanceOf(Date);
    expect(repository.refreshTokenRecords).toHaveLength(2);
    expect(recordAt(repository, 1).familyId).toBe(oldRecord.familyId);
    expect(recordAt(repository, 1).usedAt).toBeNull();
    expect(recordAt(repository, 1).tokenHash).toBe(
      hashRefreshToken(pair.refreshToken),
    );
  });

  it("reusing a refresh token revokes the whole family (AUTH-4)", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);
    const first = await refresh(started.baseUrl, body.refreshToken);
    const pair = (await first.json()) as { refreshToken: string };

    expect(first.status).toBe(200);

    const reuse = await refresh(started.baseUrl, body.refreshToken);
    expect(reuse.status).toBe(401);
    expect(await reuse.json()).toEqual({ error: "Invalid or expired token" });

    const rotated = await refresh(started.baseUrl, pair.refreshToken);
    expect(rotated.status).toBe(401);
    expect(await rotated.json()).toEqual({ error: "Invalid or expired token" });
    expect(recordAt(repository, 0).revokedAt).toBeInstanceOf(Date);
    expect(recordAt(repository, 1).revokedAt).toBeInstanceOf(Date);
  });

  it("expired, revoked and unknown tokens return the identical 401 body", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    const expiredToken = (await signup(started.baseUrl)).body.refreshToken;
    const revokedToken = (await login(started.baseUrl)).body.refreshToken;
    const unknownToken = generateRefreshToken();
    recordAt(repository, 0).expiresAt = new Date(Date.now() - 1000);

    const logout = await post(started.baseUrl, "/auth/logout", {
      refreshToken: revokedToken,
    });
    expect(logout.status).toBe(204);

    const expired = await refresh(started.baseUrl, expiredToken);
    const revoked = await refresh(started.baseUrl, revokedToken);
    const unknown = await refresh(started.baseUrl, unknownToken);

    expect(expired.status).toBe(401);
    expect(revoked.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await expired.json()).toEqual({ error: "Invalid or expired token" });
    expect(await revoked.json()).toEqual({ error: "Invalid or expired token" });
    expect(await unknown.json()).toEqual({ error: "Invalid or expired token" });
  });

  it("refresh for a deleted user revokes the family and returns 401", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);

    repository.byEmail.delete("user@example.com");

    const response = await refresh(started.baseUrl, body.refreshToken);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid or expired token" });
    expect(recordAt(repository, 0).revokedAt).toBeInstanceOf(Date);
  });

  it("logout revokes the family and an unknown token still returns 204", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);

    const logout = await post(started.baseUrl, "/auth/logout", {
      refreshToken: body.refreshToken,
    });
    expect(logout.status).toBe(204);

    const later = await refresh(started.baseUrl, body.refreshToken);
    expect(later.status).toBe(401);

    const unknown = await post(started.baseUrl, "/auth/logout", {
      refreshToken: generateRefreshToken(),
    });
    expect(unknown.status).toBe(204);
  });

  it("logout-all revokes both device families (AUTH-5)", async () => {
    const { app, repository } = setup();
    const started = await startServer(app);
    server = started.server;
    const first = (await signup(started.baseUrl)).body;
    const second = (await login(started.baseUrl)).body;

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(recordAt(repository, 1).familyId).not.toBe(
      recordAt(repository, 0).familyId,
    );

    const withoutToken = await post(started.baseUrl, "/auth/logout-all", {});
    expect(withoutToken.status).toBe(401);

    const logoutAll = await post(
      started.baseUrl,
      "/auth/logout-all",
      {},
      second.accessToken,
    );
    expect(logoutAll.status).toBe(204);

    const firstRefresh = await refresh(started.baseUrl, first.refreshToken);
    const secondRefresh = await refresh(started.baseUrl, second.refreshToken);
    expect(firstRefresh.status).toBe(401);
    expect(secondRefresh.status).toBe(401);
  });

  it("refresh returns 429 with Retry-After after 60 requests per IP", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;
    let current = (await signup(started.baseUrl)).body.refreshToken;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await refresh(started.baseUrl, current);
      expect(response.status).toBe(200);
      current = ((await response.json()) as { refreshToken: string }).refreshToken;
    }

    const limited = await refresh(started.baseUrl, current);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("900");
    expect(await limited.json()).toEqual({ error: "Too many requests" });
  });

  it("refresh returns 503 when Redis is unavailable", async () => {
    const { app, redis } = setup();
    const started = await startServer(app);
    server = started.server;
    const { body } = await signup(started.baseUrl);
    redis.fail = true;

    const response = await refresh(started.baseUrl, body.refreshToken);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Service unavailable" });
  });

  it("refresh rejects a body with no valid refresh token", async () => {
    const { app } = setup();
    const started = await startServer(app);
    server = started.server;

    const response = await post(started.baseUrl, "/auth/refresh", {
      refreshToken: "short",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  });
});
