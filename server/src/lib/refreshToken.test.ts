import { describe, expect, it } from "vitest";

import { generateRefreshToken, hashRefreshToken } from "./refreshToken.js";

describe("refresh tokens", () => {
  it("two generated tokens differ", () => {
    expect(generateRefreshToken()).not.toBe(generateRefreshToken());
  });

  it("hash is 64 hex characters", () => {
    expect(hashRefreshToken(generateRefreshToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same token always gives the same hash", () => {
    const token = generateRefreshToken();

    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it("hash is not the token", () => {
    const token = generateRefreshToken();

    expect(hashRefreshToken(token)).not.toBe(token);
  });
});
