import { describe, expect, it } from "vitest";
import { z } from "zod";

import { envSchema, GOOGLE_CLIENT_ID_ERROR } from "./envSchema.js";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://localhost:5432/rota",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "0123456789abcdef0123456789abcdef",
};

function parseWithGoogle(value?: string) {
  return envSchema.safeParse(
    value === undefined ? baseEnv : { ...baseEnv, GOOGLE_WEB_CLIENT_ID: value },
  );
}

describe("GOOGLE_WEB_CLIENT_ID", () => {
  it("trims surrounding whitespace", () => {
    const result = parseWithGoogle(
      "  rota-test.apps.googleusercontent.com  ",
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GOOGLE_WEB_CLIENT_ID).toBe(
        "rota-test.apps.googleusercontent.com",
      );
    }
  });

  it("rejects a wrong-looking value without printing it", () => {
    const badValue = "  bad-client-id-1234567890  ";
    const result = parseWithGoogle(badValue);

    expect(result.success).toBe(false);
    if (!result.success) {
      const message = z.prettifyError(result.error);
      expect(message).toContain("GOOGLE_WEB_CLIENT_ID");
      expect(message).toContain(GOOGLE_CLIENT_ID_ERROR);
      expect(message).not.toContain("bad-client-id-1234567890");
    }
  });

  it("allows a missing or blank value", () => {
    const missing = parseWithGoogle();
    const blank = parseWithGoogle("   ");

    expect(missing.success).toBe(true);
    expect(blank.success).toBe(true);
    if (missing.success) {
      expect(missing.data.GOOGLE_WEB_CLIENT_ID).toBeUndefined();
    }
    if (blank.success) {
      expect(blank.data.GOOGLE_WEB_CLIENT_ID).toBeUndefined();
    }
  });
});
