import type { Server } from "node:http";

import type { Express } from "express";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  type DatabaseCheck,
  type RedisCheck,
} from "./app.js";

const databaseFailureMessage = "database password is wrong";
const redisFailureMessage = "redis connection refused";

const databaseOk: DatabaseCheck = () => Promise.resolve();
const databaseDown: DatabaseCheck = () =>
  Promise.reject(new Error(databaseFailureMessage));

const redisOk: RedisCheck = () => Promise.resolve(true);
const redisDown: RedisCheck = () => Promise.resolve(false);
const redisThrows: RedisCheck = () =>
  Promise.reject(new Error(redisFailureMessage));

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

function expectNoErrorText(body: unknown): void {
  const text = JSON.stringify(body);
  expect(text).not.toContain(databaseFailureMessage);
  expect(text).not.toContain(redisFailureMessage);
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
    const started = await startServer(createApp(databaseOk, redisOk));
    server = started.server;

    const response = await fetch(`${started.baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("GET /health/ready returns 200 when both checks succeed", async () => {
    const started = await startServer(createApp(databaseOk, redisOk));
    server = started.server;

    const response = await fetch(`${started.baseUrl}/health/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      database: "ok",
      redis: "ok",
    });
  });

  it("GET /health/ready returns 503 without leaking the error when the database fails", async () => {
    const started = await startServer(createApp(databaseDown, redisOk));
    server = started.server;

    const response = await fetch(`${started.baseUrl}/health/ready`);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "error",
      database: "unavailable",
      redis: "ok",
    });
    expectNoErrorText(body);
  });

  it("GET /health/ready returns 503 without leaking the error when redis fails", async () => {
    const started = await startServer(createApp(databaseOk, redisDown));
    server = started.server;

    const response = await fetch(`${started.baseUrl}/health/ready`);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "error",
      database: "ok",
      redis: "unavailable",
    });
    expectNoErrorText(body);
  });

  it("GET /health/ready returns 503 without leaking the error when the redis check throws", async () => {
    const started = await startServer(createApp(databaseOk, redisThrows));
    server = started.server;

    const response = await fetch(`${started.baseUrl}/health/ready`);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "error",
      database: "ok",
      redis: "unavailable",
    });
    expectNoErrorText(body);
  });

  it("GET /health/ready returns 503 without leaking the error when both fail", async () => {
    const started = await startServer(createApp(databaseDown, redisDown));
    server = started.server;

    const response = await fetch(`${started.baseUrl}/health/ready`);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      status: "error",
      database: "unavailable",
      redis: "unavailable",
    });
    expectNoErrorText(body);
  });
});
