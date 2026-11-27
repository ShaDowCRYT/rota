import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBillingRouter } from "./routes.js";
import type { AuthService } from "../auth/service.js";
import type { BillingService, CheckoutResult } from "./types.js";
import type { Role, TeamsService } from "../teams/types.js";
import {
  permissiveLimiter,
  startServer,
  unusedAuthService,
  unusedBillingService,
  unusedTeamsService,
} from "../../test/helpers.js";

interface HarnessOptions {
  role?: Role;
  paymentsEnabled?: boolean;
  checkout?: BillingService["checkout"];
}

function harness(options: HarnessOptions = {}) {
  const teamId = randomUUID();
  const userId = randomUUID();
  const email = `${userId}@proof.invalid`;
  const checkout = vi.fn(
    options.checkout ??
      (async (): Promise<CheckoutResult> => ({
        checkoutUrl: "https://checkout.test/",
        paymentId: randomUUID(),
        amountCents: 2000,
        currency: "USD",
      })),
  );

  const authService: AuthService = {
    ...unusedAuthService,
    async verifyAccessToken(token) {
      return token === "valid-token" ? userId : undefined;
    },
    async loadUserById(id) {
      return id === userId ? { id: userId, email } : undefined;
    },
  };

  const teamsService: TeamsService = {
    ...unusedTeamsService,
    async getMembership(id, memberId) {
      if (options.role === undefined) return undefined;
      return { teamId: id, userId: memberId, role: options.role };
    },
  };

  const billingService: BillingService = {
    ...unusedBillingService,
    checkout,
  };

  const app = express();
  app.use(express.json());
  app.use(
    createBillingRouter(authService, billingService, teamsService, permissiveLimiter, {
      paymentsEnabled: options.paymentsEnabled ?? true,
    }),
  );

  return { app, checkout, email, teamId, userId };
}

async function postCheckout(
  baseUrl: string,
  teamId: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/teams/${teamId}/billing/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("billing checkout route", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("lets an owner check out and returns the integer amount from the service", async () => {
    const created = harness({ role: "owner" });
    const started = await startServer(created.app);
    server = started.server;

    const response = await postCheckout(
      started.baseUrl,
      created.teamId,
      { planId: "starter", seats: 5 },
      { authorization: "Bearer valid-token", "idempotency-key": "proof-key-2000" },
    );
    const body = (await response.json()) as CheckoutResult;

    expect(response.status).toBe(200);
    expect(body.amountCents).toBe(2000);
    expect(body.currency).toBe("USD");
    expect(created.checkout).toHaveBeenCalledWith(
      created.teamId,
      created.userId,
      created.email,
      "proof-key-2000",
      { planId: "starter", seats: 5 },
    );
  });

  it("forbids a staff member before calling the billing service", async () => {
    const created = harness({ role: "staff" });
    const started = await startServer(created.app);
    server = started.server;

    const response = await postCheckout(
      started.baseUrl,
      created.teamId,
      { planId: "starter", seats: 5 },
      { authorization: "Bearer valid-token", "idempotency-key": "proof-key-403" },
    );

    expect(response.status).toBe(403);
    expect(created.checkout).not.toHaveBeenCalled();
  });

  it("rejects a missing access token", async () => {
    const created = harness({ role: "owner" });
    const started = await startServer(created.app);
    server = started.server;

    const response = await postCheckout(
      started.baseUrl,
      created.teamId,
      { planId: "starter", seats: 5 },
      { authorization: "Bearer invalid-token", "idempotency-key": "proof-key-401" },
    );

    expect(response.status).toBe(401);
    expect(created.checkout).not.toHaveBeenCalled();
  });

  it("rejects a short idempotency key with 400", async () => {
    const created = harness({ role: "owner" });
    const started = await startServer(created.app);
    server = started.server;

    const response = await postCheckout(
      started.baseUrl,
      created.teamId,
      { planId: "starter", seats: 5 },
      { authorization: "Bearer valid-token", "idempotency-key": "short" },
    );

    expect(response.status).toBe(400);
    expect(created.checkout).not.toHaveBeenCalled();
  });

  it("rejects an unexpected body field with 400", async () => {
    const created = harness({ role: "owner" });
    const started = await startServer(created.app);
    server = started.server;

    const response = await postCheckout(
      started.baseUrl,
      created.teamId,
      { planId: "starter", seats: 5, role: "owner" },
      { authorization: "Bearer valid-token", "idempotency-key": "proof-key-400" },
    );

    expect(response.status).toBe(400);
    expect(created.checkout).not.toHaveBeenCalled();
  });

  it("returns 503 when payments are not configured", async () => {
    const created = harness({ role: "owner", paymentsEnabled: false });
    const started = await startServer(created.app);
    server = started.server;

    const response = await postCheckout(
      started.baseUrl,
      created.teamId,
      { planId: "starter", seats: 5 },
      { authorization: "Bearer valid-token", "idempotency-key": "proof-key-503" },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Payments are not available" });
    expect(created.checkout).not.toHaveBeenCalled();
  });
});
