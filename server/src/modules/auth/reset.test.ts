import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { hashOpaqueToken } from "../../lib/opaqueToken.js";
import { createTokenIssuer } from "../../lib/tokens.js";
import { createRedisFixedWindowLimiter } from "../../middleware/rateLimit.js";
import {
  createFakePasswords,
  FakeAuthRepository,
  FakeEmailSender,
  FakePasswordResetRepository,
  FakeRedis,
  startServer,
  testRefreshTtlDays,
  testResetTtlMinutes,
  testTokenConfig,
  unusedActivityService,
  unusedShiftsService,
  unusedSwapsService,
  unusedTeamsService,
  unusedBillingService,
} from "../../test/helpers.js";
import { createResetService } from "./resetService.js";
import { createAuthService } from "./service.js";

const credentials = {
  email: "User@Example.COM",
  password: "correct horse battery staple",
};
const newPassword = "a different password value";
const forgotBody = {
  message: "If that email exists, a reset link has been sent.",
};
const invalidTokenBody = { error: "Invalid or expired token" };
const invalidRequestBody = { error: "Invalid request" };
const invalidCredentialsBody = { error: "Invalid email or password" };

type HttpResponse = Awaited<ReturnType<typeof fetch>>;

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
  const resetRepository = new FakePasswordResetRepository();
  const emailSender = new FakeEmailSender();
  const resetService = createResetService({
    repository: resetRepository,
    authService,
    passwords,
    emailSender,
    ttlMinutes: testResetTtlMinutes,
  });
  const redis = new FakeRedis();
  const app = createApp({
    checkDatabase: () => Promise.resolve(),
    checkRedis: () => Promise.resolve(true),
    authService,
    limiter: createRedisFixedWindowLimiter(redis),
    teamsService: unusedTeamsService,
    billingService: unusedBillingService,
    activityService: unusedActivityService,
    shiftsService: unusedShiftsService,
    swapsService: unusedSwapsService,
    resetRepository,
    passwords,
    emailSender,
    resetTtlMinutes: testResetTtlMinutes,
    trustProxyHops: 0,
  });

  return { repository, passwords, authService, resetService, resetRepository, emailSender, app };
}

async function post(baseUrl: string, path: string, body: unknown): Promise<HttpResponse> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function tokenFromEmail(emailSender: FakeEmailSender, index = 0): string {
  const message = emailSender.messages[index];
  if (message === undefined) {
    throw new Error("expected a reset email message");
  }
  const match = /rota:\/\/reset\?token=([A-Za-z0-9_-]+)/.exec(message.text);
  const token = match?.[1];
  if (token === undefined) {
    throw new Error("expected a reset token in the email text");
  }
  return token;
}

function onlyResetRecord(resetRepository: FakePasswordResetRepository) {
  const records = [...resetRepository.tokens.values()];
  expect(records).toHaveLength(1);
  const record = records[0];
  if (record === undefined) {
    throw new Error("expected one reset token record");
  }
  return record;
}

function expectNoToken(bodies: string[], token: string): void {
  for (const body of bodies) {
    expect(body.includes(token)).toBe(false);
  }
}

describe("password reset (AUTH-7)", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("returns the identical 202 body for known and unknown emails and emails the link only as text", async () => {
    const { app, emailSender, resetRepository } = setup();
    const started = await startServer(app);
    server = started.server;

    const signup = await post(started.baseUrl, "/auth/signup", credentials);
    const signupText = await signup.text();
    expect(signup.status).toBe(201);

    const known = await post(started.baseUrl, "/auth/forgot", { email: credentials.email });
    const knownText = await known.text();
    expect(known.status).toBe(202);
    expect(JSON.parse(knownText)).toEqual(forgotBody);

    const unknown = await post(started.baseUrl, "/auth/forgot", { email: "nobody@example.com" });
    const unknownText = await unknown.text();
    expect(unknown.status).toBe(202);
    expect(unknownText).toBe(knownText);
    expect(JSON.parse(unknownText)).toEqual(forgotBody);
    expect(emailSender.messages).toHaveLength(1);

    const message = emailSender.messages[0];
    if (message === undefined) {
      throw new Error("expected one email message");
    }
    expect(Object.keys(message).sort()).toEqual(["subject", "text", "to"]);
    const token = tokenFromEmail(emailSender);
    expect(message.text.includes("rota://reset?token=")).toBe(true);
    expect(message.to.includes(token)).toBe(false);
    expect(message.subject.includes(token)).toBe(false);
    const record = onlyResetRecord(resetRepository);
    expect(record.tokenHash === hashOpaqueToken(token)).toBe(true);
    expectNoToken([signupText, knownText, unknownText], token);
  });

  it("a valid token resets the password, the new password logs in and the old one fails", async () => {
    const { app, emailSender, resetRepository } = setup();
    const started = await startServer(app);
    server = started.server;

    const signup = await post(started.baseUrl, "/auth/signup", credentials);
    const signupText = await signup.text();
    expect(signup.status).toBe(201);

    const forgot = await post(started.baseUrl, "/auth/forgot", { email: credentials.email });
    const forgotText = await forgot.text();
    expect(forgot.status).toBe(202);
    const token = tokenFromEmail(emailSender);

    const reset = await post(started.baseUrl, "/auth/reset", { token, newPassword });
    const resetText = await reset.text();
    expect(reset.status).toBe(204);
    expect(resetText).toBe("");
    expect(onlyResetRecord(resetRepository).usedAt).toBeInstanceOf(Date);

    const newLogin = await post(started.baseUrl, "/auth/login", {
      email: credentials.email,
      password: newPassword,
    });
    const newLoginText = await newLogin.text();
    expect(newLogin.status).toBe(200);
    const newLoginBody = JSON.parse(newLoginText) as { accessToken?: unknown };
    expect(typeof newLoginBody.accessToken).toBe("string");

    const oldLogin = await post(started.baseUrl, "/auth/login", credentials);
    const oldLoginText = await oldLogin.text();
    expect(oldLogin.status).toBe(401);
    expect(JSON.parse(oldLoginText)).toEqual(invalidCredentialsBody);

    expectNoToken([signupText, forgotText, resetText, newLoginText, oldLoginText], token);
  });

  it("rejects a second use of the same token with 400", async () => {
    const { app, emailSender } = setup();
    const started = await startServer(app);
    server = started.server;

    await post(started.baseUrl, "/auth/signup", credentials);
    const forgot = await post(started.baseUrl, "/auth/forgot", { email: credentials.email });
    await forgot.text();
    const token = tokenFromEmail(emailSender);

    const first = await post(started.baseUrl, "/auth/reset", { token, newPassword });
    expect(first.status).toBe(204);
    const firstText = await first.text();

    const second = await post(started.baseUrl, "/auth/reset", { token, newPassword });
    const secondText = await second.text();
    expect(second.status).toBe(400);
    expect(JSON.parse(secondText)).toEqual(invalidTokenBody);
    expectNoToken([firstText, secondText], token);
  });

  it("rejects an expired token with the same 400 body", async () => {
    const { app, emailSender, resetRepository } = setup();
    const started = await startServer(app);
    server = started.server;

    await post(started.baseUrl, "/auth/signup", credentials);
    const forgot = await post(started.baseUrl, "/auth/forgot", { email: credentials.email });
    await forgot.text();
    const token = tokenFromEmail(emailSender);
    const record = onlyResetRecord(resetRepository);
    record.expiresAt = new Date(Date.now() - 1000);

    const reset = await post(started.baseUrl, "/auth/reset", { token, newPassword });
    const resetText = await reset.text();
    expect(reset.status).toBe(400);
    expect(JSON.parse(resetText)).toEqual(invalidTokenBody);
    expect(record.usedAt).toBeNull();
    expectNoToken([resetText], token);
  });

  it("a new forgot request invalidates an older unused token", async () => {
    const { app, emailSender, resetRepository } = setup();
    const started = await startServer(app);
    server = started.server;

    await post(started.baseUrl, "/auth/signup", credentials);
    const firstForgot = await post(started.baseUrl, "/auth/forgot", { email: credentials.email });
    await firstForgot.text();
    const firstToken = tokenFromEmail(emailSender);
    const firstRecord = onlyResetRecord(resetRepository);
    expect(firstRecord.usedAt).toBeNull();

    const secondForgot = await post(started.baseUrl, "/auth/forgot", { email: credentials.email });
    const secondForgotText = await secondForgot.text();
    expect(secondForgot.status).toBe(202);
    const secondToken = tokenFromEmail(emailSender, 1);
    expect(emailSender.messages).toHaveLength(2);
    expect(resetRepository.tokens.size).toBe(2);
    expect(firstToken === secondToken).toBe(false);
    expect(firstRecord.usedAt).toBeInstanceOf(Date);

    const oldReset = await post(started.baseUrl, "/auth/reset", { token: firstToken, newPassword });
    const oldResetText = await oldReset.text();
    expect(oldReset.status).toBe(400);
    expect(JSON.parse(oldResetText)).toEqual(invalidTokenBody);

    const newReset = await post(started.baseUrl, "/auth/reset", { token: secondToken, newPassword });
    const newResetText = await newReset.text();
    expect(newReset.status).toBe(204);
    expectNoToken([secondForgotText, oldResetText, newResetText], firstToken);
    expectNoToken([secondForgotText, oldResetText, newResetText], secondToken);
  });

  it("reset revokes every refresh token issued before it", async () => {
    const { app, emailSender, repository } = setup();
    const started = await startServer(app);
    server = started.server;

    const signup = await post(started.baseUrl, "/auth/signup", credentials);
    const signupText = await signup.text();
    expect(signup.status).toBe(201);
    const signupPair = JSON.parse(signupText) as { refreshToken: string };

    const login = await post(started.baseUrl, "/auth/login", credentials);
    const loginText = await login.text();
    expect(login.status).toBe(200);
    const loginPair = JSON.parse(loginText) as { refreshToken: string };
    expect(repository.refreshTokenRecords).toHaveLength(2);
    expect(signupPair.refreshToken === loginPair.refreshToken).toBe(false);

    const forgot = await post(started.baseUrl, "/auth/forgot", { email: credentials.email });
    await forgot.text();
    const token = tokenFromEmail(emailSender);

    const reset = await post(started.baseUrl, "/auth/reset", { token, newPassword });
    await reset.text();
    expect(reset.status).toBe(204);
    expect(repository.refreshTokenRecords.every((record) => record.revokedAt instanceof Date)).toBe(true);
    expect(repository.refreshTokenRecords.every((record) => record.usedAt === null)).toBe(true);

    const firstRefresh = await post(started.baseUrl, "/auth/refresh", {
      refreshToken: signupPair.refreshToken,
    });
    const firstRefreshText = await firstRefresh.text();
    expect(firstRefresh.status).toBe(401);
    expect(JSON.parse(firstRefreshText)).toEqual(invalidTokenBody);

    const secondRefresh = await post(started.baseUrl, "/auth/refresh", {
      refreshToken: loginPair.refreshToken,
    });
    const secondRefreshText = await secondRefresh.text();
    expect(secondRefresh.status).toBe(401);
    expect(JSON.parse(secondRefreshText)).toEqual(invalidTokenBody);

    expectNoToken(
      [signupText, loginText, firstRefreshText, secondRefreshText],
      token,
    );
  });

  it("resets a user whose password hash is null", async () => {
    const { app, emailSender, repository } = setup();
    const started = await startServer(app);
    server = started.server;

    const signup = await post(started.baseUrl, "/auth/signup", credentials);
    await signup.text();
    expect(signup.status).toBe(201);
    const user = repository.byEmail.get("user@example.com");
    if (user === undefined) {
      throw new Error("expected a signed-up user");
    }
    user.passwordHash = null;

    const oldLogin = await post(started.baseUrl, "/auth/login", credentials);
    const oldLoginText = await oldLogin.text();
    expect(oldLogin.status).toBe(401);
    expect(JSON.parse(oldLoginText)).toEqual(invalidCredentialsBody);

    const forgot = await post(started.baseUrl, "/auth/forgot", { email: credentials.email });
    await forgot.text();
    expect(forgot.status).toBe(202);
    const token = tokenFromEmail(emailSender);

    const reset = await post(started.baseUrl, "/auth/reset", { token, newPassword });
    await reset.text();
    expect(reset.status).toBe(204);

    const newLogin = await post(started.baseUrl, "/auth/login", {
      email: credentials.email,
      password: newPassword,
    });
    const newLoginText = await newLogin.text();
    expect(newLogin.status).toBe(200);
    const newLoginBody = JSON.parse(newLoginText) as { accessToken?: unknown };
    expect(typeof newLoginBody.accessToken).toBe("string");
    expectNoToken([oldLoginText, newLoginText], token);
  });

  it("rejects invalid bodies with 400 and never puts the token in a response", async () => {
    const { app, emailSender } = setup();
    const started = await startServer(app);
    server = started.server;

    await post(started.baseUrl, "/auth/signup", credentials);
    const forgot = await post(started.baseUrl, "/auth/forgot", { email: credentials.email });
    await forgot.text();
    expect(forgot.status).toBe(202);
    const token = tokenFromEmail(emailSender);

    const cases: HttpResponse[] = [
      await post(started.baseUrl, "/auth/forgot", {}),
      await post(started.baseUrl, "/auth/reset", { token, newPassword: "short" }),
      await post(started.baseUrl, "/auth/reset", { token: "too-short", newPassword }),
      await post(started.baseUrl, "/auth/reset", {}),
    ];
    const bodies: string[] = [];
    for (const response of cases) {
      const text = await response.text();
      bodies.push(text);
      expect(response.status).toBe(400);
      expect(JSON.parse(text)).toEqual(invalidRequestBody);
    }
    expectNoToken(bodies, token);
  });

  it("createResetService emails the link only as text and consumes the token once", async () => {
    const { repository, passwords, resetService, emailSender, resetRepository } = setup();
    const hash = await passwords.hash(credentials.password);
    await repository.createUser("user@example.com", hash);

    await resetService.requestReset("user@example.com");
    expect(emailSender.messages).toHaveLength(1);
    const message = emailSender.messages[0];
    if (message === undefined) {
      throw new Error("expected one email message");
    }
    expect(Object.keys(message).sort()).toEqual(["subject", "text", "to"]);
    const token = tokenFromEmail(emailSender);
    expect(message.text.includes("rota://reset?token=")).toBe(true);
    expect(message.to.includes(token)).toBe(false);
    expect(message.subject.includes(token)).toBe(false);
    const record = onlyResetRecord(resetRepository);
    expect(record.tokenHash === hashOpaqueToken(token)).toBe(true);

    await resetService.reset(token, newPassword);
    expect(record.usedAt).toBeInstanceOf(Date);
    await expect(resetService.reset(token, newPassword)).rejects.toMatchObject({
      status: 400,
      message: invalidTokenBody.error,
    });
  });
});


