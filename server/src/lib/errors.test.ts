import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";
import { describe, expect, it } from "vitest";

import { getPostgresErrorCode, isUniqueViolation } from "./errors.js";

function realUniqueViolation(): DrizzleQueryError {
  const cause = new DatabaseError(
    "duplicate key value violates unique constraint",
    0,
    "error",
  );
  cause.code = "23505";
  return new DrizzleQueryError("insert into users", [], cause);
}

describe("postgres error codes", () => {
  it("reads a code nested under cause from a real drizzle error", () => {
    const error = realUniqueViolation();

    expect(getPostgresErrorCode(error)).toBe("23505");
    expect(isUniqueViolation(error)).toBe(true);
  });

  it("reads a code directly on a postgres error", () => {
    const cause = new DatabaseError("duplicate key", 0, "error");
    cause.code = "23505";

    expect(getPostgresErrorCode(cause)).toBe("23505");
    expect(isUniqueViolation(cause)).toBe(true);
  });

  it("does not treat other codes as unique violations", () => {
    const cause = new DatabaseError("foreign key violation", 0, "error");
    cause.code = "23503";

    expect(isUniqueViolation(new DrizzleQueryError("insert", [], cause))).toBe(false);
    expect(isUniqueViolation(new Error("plain"))).toBe(false);
  });
});
