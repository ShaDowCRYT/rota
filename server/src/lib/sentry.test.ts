import type { Server } from "node:http";

import * as Sentry from "@sentry/node";
import express, { type Express } from "express";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { errorHandler } from "../middleware/errorHandler.js";
import { initSentry, scrubSensitiveData } from "./sentry.js";

const fakeDsn = "https://public@example.com/1";

type SentryTransport = ReturnType<
  NonNullable<Sentry.NodeOptions["transport"]>
>;
type SentryEnvelope = Parameters<SentryTransport["send"]>[0];

function createFakeTransport(): {
  envelopes: SentryEnvelope[];
  transport: SentryTransport;
} {
  const envelopes: SentryEnvelope[] = [];
  return {
    envelopes,
    transport: {
      send: (envelope) => {
        envelopes.push(envelope);
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    },
  };
}

function findEvents(envelopes: SentryEnvelope[]): Sentry.Event[] {
  const events: Sentry.Event[] = [];
  for (const envelope of envelopes) {
    for (const item of envelope[1]) {
      if (item[0].type === "event") {
        events.push(item[1] as Sentry.Event);
      }
    }
  }
  return events;
}

function hasHeader(
  headers: Record<string, string> | undefined,
  name: string,
): boolean {
  if (headers === undefined) {
    return false;
  }
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function startServer(
  app: Express,
): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Expected the server to bind to a TCP port"));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe("sentry", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  afterAll(async () => {
    await Sentry.close();
  });

  it("captures a handled error and removes sensitive request data", async () => {
    const fake = createFakeTransport();
    const initialized = initSentry({
      dsn: fakeDsn,
      environment: "test",
      transport: () => fake.transport,
    });
    expect(initialized).toBe(true);

    const app = express();
    app.use(express.json());
    app.post("/boom", (_req, _res, next) => {
      next(new Error("handled test error"));
    });
    Sentry.setupExpressErrorHandler(app);
    app.use(errorHandler);

    const started = await startServer(app);
    server = started.server;

    const response = await fetch(`${started.baseUrl}/boom`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer super-secret-token",
      },
      body: JSON.stringify({ password: "super-secret-body" }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ status: "error" });
    expect(JSON.stringify(body)).not.toContain("handled test error");

    await Sentry.flush(2_000);

    const events = findEvents(fake.envelopes);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.exception?.values?.[0]?.value).toBe("handled test error");
    expect(event?.request?.data).toBeUndefined();
    expect(event?.request?.cookies).toBeUndefined();
    expect(hasHeader(event?.request?.headers, "authorization")).toBe(false);
  });

  it("strips the request body, cookies, and authorization header", () => {
    const event: Sentry.ErrorEvent = {
      type: undefined,
      request: {
        data: { password: "super-secret-body" },
        cookies: { session: "super-secret-cookie" },
        headers: {
          authorization: "Bearer super-secret-token",
          "content-type": "application/json",
        },
      },
    };

    const scrubbed = scrubSensitiveData(event);

    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(hasHeader(scrubbed.request?.headers, "authorization")).toBe(false);
    expect(scrubbed.request?.headers?.["content-type"]).toBe(
      "application/json",
    );
  });
});
