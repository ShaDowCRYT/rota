import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";

import { createApp } from "./app.js";
import { unusedBillingService } from "./test/helpers.js";

function unused<T>(name: string): T {
  return new Proxy({} as object, {
    get() {
      throw new Error(`${name} should not be used`);
    },
  }) as T;
}

async function start(app: ReturnType<typeof createApp>) {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server?: Server) {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

describe("trust proxy", () => {
  let server: Server | undefined;
  afterEach(async () => { const s = server; server = undefined; await close(s); });

  it("ignores spoofed X-Forwarded-For when trust proxy hops is 0", async () => {
    const app = createApp({
      checkDatabase: async () => {},
      checkRedis: async () => true,
      authService: unused("authService"),
      limiter: unused("limiter"),
      teamsService: unused("teamsService"),
      billingService: unusedBillingService,
      activityService: unused("activityService"),
      shiftsService: unused("shiftsService"),
      swapsService: unused("swapsService"),
      resetRepository: unused("resetRepository"),
      passwords: unused("passwords"),
      emailSender: unused("emailSender"),
      resetTtlMinutes: 30,
      trustProxyHops: 0,
    });
    app.get("/ip", (req, res) => res.json({ ip: req.ip }));
    const started = await start(app);
    server = started.server;
    const response = await fetch(`${started.baseUrl}/ip`, { headers: { "x-forwarded-for": "203.0.113.9" } });
    const body = await response.json() as { ip: string };
    expect(response.status).toBe(200);
    expect(body.ip).not.toBe("203.0.113.9");
  });

  it("uses client X-Forwarded-For entry when trust proxy hops is 1", async () => {
    const app = createApp({
      checkDatabase: async () => {},
      checkRedis: async () => true,
      authService: unused("authService"),
      limiter: unused("limiter"),
      teamsService: unused("teamsService"),
      billingService: unusedBillingService,
      activityService: unused("activityService"),
      shiftsService: unused("shiftsService"),
      swapsService: unused("swapsService"),
      resetRepository: unused("resetRepository"),
      passwords: unused("passwords"),
      emailSender: unused("emailSender"),
      resetTtlMinutes: 30,
      trustProxyHops: 1,
    });
    app.get("/ip", (req, res) => res.json({ ip: req.ip }));
    const started = await start(app);
    server = started.server;
    const response = await fetch(`${started.baseUrl}/ip`, { headers: { "x-forwarded-for": "203.0.113.9" } });
    const body = await response.json() as { ip: string };
    expect(response.status).toBe(200);
    expect(body.ip).toBe("203.0.113.9");
  });
});
