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
  testTokenConfig,
} from "../../test/helpers.js";
import { createTokenIssuer } from "../../lib/tokens.js";
import { createAuthService } from "./service.js";

const credentials = {
  email: "User@Example.COM",
  password: "correct horse battery staple",
};

function setup(ttlSeconds = testTokenConfig.ttlSeconds) {
  const repository = new FakeAuthRepository();
  const passwords = createFakePasswords();
  const tokens = createTokenIssuer({ ...testTokenConfig, ttlSeconds });
  const authService = createAuthService({ repository, passwords, tokens });
  const app = createApp({
    checkDatabase: () => Promise.resolve(),
    checkRedis: () => Promise.resolve(true),
    authService,
    limiter: createRedisFixedWindowLimiter(new FakeRedis()),
  });

  return { repository, passwords, tokens, app };
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
  };
  return { response, body };
}

function encodePart(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
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
    const tampered =
      body.accessToken.slice(0, -1) +
      (body.accessToken.endsWith("A") ? "B" : "A");

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
});
