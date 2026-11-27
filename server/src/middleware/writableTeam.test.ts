import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { HttpError } from "../lib/errors.js";
import {
  createFakePasswords,
  permissiveLimiter,
  startServer,
  testResetTtlMinutes,
  unusedActivityService,
  unusedAuthService,
  unusedBillingService,
  unusedEmailSender,
  unusedPasswordResetRepository,
  unusedShiftsService,
  unusedSwapsService,
  unusedTeamsService,
} from "../test/helpers.js";
import type { Role } from "../modules/teams/types.js";
import type { BillingStatus } from "../modules/billing/types.js";

function statusFor(role: Role | undefined): BillingStatus {
  const owner = role === "owner";
  return {
    planId: "team",
    planName: "Team",
    status: "restricted",
    seats: 15,
    seatsUsed: 4,
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2026-01-31T00:00:00.000Z",
    pendingPlanId: null,
    pendingSeats: null,
    graceEndsAt: "2026-02-05T00:00:00.000Z",
    lastNotice: 3,
    monthlyTotalCents: 5000,
    amountDueCents: owner ? 5000 : null,
    renewalCheckoutUrl: owner ? "https://payments.test/renew" : null,
    latestPaymentStatus: "failed",
  };
}

function appFor(options: { role: Role; writable: boolean }) {
  const teamId = randomUUID();
  const userId = randomUUID();
  const authService = {
    ...unusedAuthService,
    async verifyAccessToken() {
      return userId;
    },
    async loadUserById() {
      return { id: userId, email: "member@example.test" };
    },
  };
  const teamsService = {
    ...unusedTeamsService,
    async getMembership() {
      return { teamId, userId, role: options.role };
    },
  };
  const billingService = {
    ...unusedBillingService,
    async assertTeamWritable() {
      if (!options.writable) {
        throw new HttpError(402, "This team's subscription needs attention");
      }
    },
    async getStatus(_teamId: string, viewerRole?: Role) {
      return statusFor(viewerRole);
    },
  };

  return {
    teamId,
    app: createApp({
      checkDatabase: () => Promise.resolve(),
      checkRedis: () => Promise.resolve(true),
      authService,
      limiter: permissiveLimiter,
      teamsService,
      billingService,
      activityService: unusedActivityService,
      shiftsService: unusedShiftsService,
      swapsService: unusedSwapsService,
      resetRepository: unusedPasswordResetRepository,
      passwords: createFakePasswords(),
      emailSender: unusedEmailSender,
      resetTtlMinutes: testResetTtlMinutes,
      trustProxyHops: 0,
      paymentsEnabled: true,
    }),
  };
}

describe("restricted access route wiring", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("blocks shift writes for a restricted team", async () => {
    const { app, teamId } = appFor({ role: "owner", writable: false });
    const started = await startServer(app);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/teams/${teamId}/shifts`, {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        assigneeId: randomUUID(),
        startsAt: "2026-02-01T09:00:00+01:00",
        endsAt: "2026-02-01T17:00:00+01:00",
      }),
    });

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: "This team's subscription needs attention",
    });
  });

  it("lets staff read billing without owner-only renewal details", async () => {
    const { app, teamId } = appFor({ role: "staff", writable: false });
    const started = await startServer(app);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/teams/${teamId}/billing`, {
      headers: { authorization: "Bearer token" },
    });
    const body = (await response.json()) as BillingStatus;

    expect(response.status).toBe(200);
    expect(body.status).toBe("restricted");
    expect(body.amountDueCents).toBeNull();
    expect(body.renewalCheckoutUrl).toBeNull();
  });

  it("lets an owner see renewal details while restricted", async () => {
    const { app, teamId } = appFor({ role: "owner", writable: false });
    const started = await startServer(app);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/teams/${teamId}/billing`, {
      headers: { authorization: "Bearer token" },
    });
    const body = (await response.json()) as BillingStatus;

    expect(response.status).toBe(200);
    expect(body.amountDueCents).toBe(5000);
    expect(body.renewalCheckoutUrl).toBe("https://payments.test/renew");
  });
});
