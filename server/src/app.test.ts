import type { Server } from "node:http";

import type { Express } from "express";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, type DatabaseCheck } from "./app.js";

const databaseOk: DatabaseCheck = () => Promise.resolve();
const databaseFailureMessage = "database password is wrong";
const databaseDown: DatabaseCheck = () =>
  Promise.reject(new Error(databaseFailureMessage));

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

describe("health routes", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("GET /health returns 200 and status ok", async () => {
    const started = await startServer(createApp(databaseOk));
    server = started.server;

    const response = await fetch(`${started.baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("GET /health/ready returns 200 when the database check succeeds", async () => {
    const started = await startServer(createApp(databaseOk));
    server = started.server;

    const response = await fetch(`${started.baseUrl}/health/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("GET /health/ready returns 503 without leaking the error", async () => {
    const started = await startServer(createApp(databaseDown));
    server = started.server;

    const response = await fetch(`${started.baseUrl}/health/ready`);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "error", database: "unavailable" });
    expect(JSON.stringify(body)).not.toContain(databaseFailureMessage);
  });
});
