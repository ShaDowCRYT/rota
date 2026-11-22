import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { Database } from "./client.js";
import { createShardRouter, shardIndexFor } from "./shard.js";

const teamIds = Array.from({ length: 64 }, (_, index) => `team-${index}`);

function expectedIndex(teamId: string, shardCount: number): number {
  const digest = createHash("sha256").update(teamId).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16) % shardCount;
}

function fakeDatabase(): Database {
  return {} as Database;
}

describe("shard router", () => {
  it("shardIndexFor is deterministic for the same team_id", () => {
    const first = shardIndexFor("team-1", 3);
    const second = shardIndexFor("team-1", 3);

    expect(first).toBe(second);
    expect(first).toBe(expectedIndex("team-1", 3));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(3);
  });

  it("createShardRouter picks a database using sha256 hashing", () => {
    const databases = [fakeDatabase(), fakeDatabase(), fakeDatabase()];
    const router = createShardRouter(databases);

    for (const teamId of teamIds) {
      const index = expectedIndex(teamId, databases.length);
      const expected = databases[index];
      expect(expected).toBeDefined();
      expect(router(teamId)).toBe(expected);
    }

    const picked = new Set(teamIds.map((teamId) => router(teamId)));
    expect(picked.size).toBeGreaterThan(1);
  });

  it("createShardRouter rejects an empty database list", () => {
    expect(() => createShardRouter([])).toThrow(
      "at least one shard database is required",
    );
  });
});
