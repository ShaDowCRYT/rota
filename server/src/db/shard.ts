import { createHash } from "node:crypto";

import type { Database } from "./client.js";

export type ShardRouter = (teamId: string) => Database;

let currentRouter: ShardRouter | undefined;
let currentDatabases: readonly Database[] = [];

export function shardIndexFor(teamId: string, shardCount: number): number {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error("shardCount must be at least 1");
  }

  const digest = createHash("sha256").update(teamId).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16) % shardCount;
}

export function createShardRouter(databases: readonly Database[]): ShardRouter {
  if (databases.length === 0) {
    throw new Error("at least one shard database is required");
  }

  return (teamId) => {
    const index = shardIndexFor(teamId, databases.length);
    const database = databases[index];
    if (database === undefined) {
      throw new Error("shard database not found");
    }
    return database;
  };
}

export function configureShards(databases: readonly Database[]): void {
  currentDatabases = databases;
  currentRouter = createShardRouter(databases);
}

export function getShardFor(teamId: string): Database {
  if (currentRouter === undefined) {
    throw new Error("shard router is not configured");
  }

  return currentRouter(teamId);
}

export function getAllShards(): readonly Database[] {
  return currentDatabases;
}
