import { describe, expect, it } from "vitest";

import { beginIdempotentRequest } from "./idempotency.js";
import type { IdempotencyRecord, IdempotencyRepository } from "./idempotency.js";
import type { Database } from "../../db/client.js";
import { fakeExecutor } from "../../test/helpers.js";

class FakeRepo implements IdempotencyRepository {
  readonly rows = new Map<string, IdempotencyRecord>();

  private key(userId: string, key: string): string {
    return `${userId}:${key}`;
  }

  async insertInProgress(
    _db: Database,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<boolean> {
    const recordKey = this.key(userId, key);
    if (this.rows.has(recordKey)) return false;
    this.rows.set(recordKey, {
      status: "in_progress",
      requestHash,
      responseStatus: null,
      responseBody: null,
    });
    return true;
  }

  async get(
    _db: Database,
    userId: string,
    key: string,
  ): Promise<IdempotencyRecord | undefined> {
    return this.rows.get(this.key(userId, key));
  }

  async markCompleted(
    _db: Database,
    userId: string,
    key: string,
    requestHash: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    const recordKey = this.key(userId, key);
    const row = this.rows.get(recordKey);
    if (row !== undefined && row.requestHash === requestHash) {
      this.rows.set(recordKey, {
        ...row,
        status: "completed",
        responseStatus,
        responseBody,
      });
    }
  }

  async deleteInProgress(
    _db: Database,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<void> {
    const recordKey = this.key(userId, key);
    const row = this.rows.get(recordKey);
    if (
      row !== undefined &&
      row.status === "in_progress" &&
      row.requestHash === requestHash
    ) {
      this.rows.delete(recordKey);
    }
  }
}

const db = fakeExecutor as never;
const request = {
  method: "POST",
  path: "/teams/t/billing/checkout",
  teamId: "t",
  planId: "team",
  seats: 15,
};

describe("beginIdempotentRequest", () => {
  it("inserts in_progress then replays completed same hash", async () => {
    const repo = new FakeRepo();
    const first = await beginIdempotentRequest(repo, db, "u1", "k1", request);
    expect(first.replay).toBeUndefined();

    await repo.markCompleted(db, "u1", "k1", first.requestHash, 200, { ok: true });
    const second = await beginIdempotentRequest(repo, db, "u1", "k1", request);

    expect(second.replay).toEqual({ status: 200, body: { ok: true } });
  });

  it("returns 409 for same hash in progress", async () => {
    const repo = new FakeRepo();
    await beginIdempotentRequest(repo, db, "u1", "k1", request);

    await expect(
      beginIdempotentRequest(repo, db, "u1", "k1", request),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("returns 422 for different hash", async () => {
    const repo = new FakeRepo();
    await beginIdempotentRequest(repo, db, "u1", "k1", request);

    await expect(
      beginIdempotentRequest(repo, db, "u1", "k1", { ...request, seats: 16 }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
