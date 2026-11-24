import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import {
  createFakePasswords,
  permissiveLimiter,
  startServer,
  testResetTtlMinutes,
  unusedActivityService,
  unusedAuthService,
  unusedEmailSender,
  unusedPasswordResetRepository,
  unusedShiftsService,
  unusedSwapsService,
  unusedTeamsService,
} from "../test/helpers.js";

function makeApp() {
  return createApp({
    checkDatabase: () => Promise.resolve(),
    checkRedis: () => Promise.resolve(true),
    authService: unusedAuthService,
    limiter: permissiveLimiter,
    teamsService: unusedTeamsService,
    activityService: unusedActivityService,
    shiftsService: unusedShiftsService,
    swapsService: unusedSwapsService,
    resetRepository: unusedPasswordResetRepository,
    passwords: createFakePasswords(),
    emailSender: unusedEmailSender,
    resetTtlMinutes: testResetTtlMinutes,
  });
}

describe("malformed JSON", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("returns 400 without exposing parser details", async () => {
    const started = await startServer(makeApp());
    server = started.server;

    const response = await fetch(`${started.baseUrl}/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid request" });
  });
});
