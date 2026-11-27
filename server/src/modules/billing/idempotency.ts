import { createHash } from "node:crypto";

import type { Database } from "../../db/client.js";
import { HttpError } from "../../lib/errors.js";

export interface IdempotencyRecord {
  status: "in_progress" | "completed";
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown | null;
}

export interface IdempotencyRepository {
  insertInProgress(
    db: Database,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<boolean>;
  get(db: Database, userId: string, key: string): Promise<IdempotencyRecord | undefined>;
  markCompleted(
    db: Database,
    userId: string,
    key: string,
    requestHash: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void>;
  deleteInProgress(db: Database, userId: string, key: string, requestHash: string): Promise<void>;
}

export interface IdempotencyRequestShape {
  method: string;
  path: string;
  teamId: string;
  planId: string;
  seats: number;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashIdempotencyRequest(request: IdempotencyRequestShape): string {
  return createHash("sha256").update(canonicalJson(request)).digest("hex");
}

export async function beginIdempotentRequest(
  repo: IdempotencyRepository,
  db: Database,
  userId: string,
  key: string,
  request: IdempotencyRequestShape,
): Promise<{ requestHash: string; replay?: { status: number; body: unknown } }> {
  const requestHash = hashIdempotencyRequest(request);
  const inserted = await repo.insertInProgress(db, userId, key, requestHash);
  if (inserted) return { requestHash };

  const existing = await repo.get(db, userId, key);
  if (existing === undefined) {
    throw new HttpError(503, "Service unavailable");
  }
  if (existing.requestHash !== requestHash) {
    throw new HttpError(422, "This key was used with a different request");
  }
  if (existing.status === "completed" && existing.responseStatus !== null) {
    return { requestHash, replay: { status: existing.responseStatus, body: existing.responseBody } };
  }
  throw new HttpError(409, "A request with this key is in progress");
}
