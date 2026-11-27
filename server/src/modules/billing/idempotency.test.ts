import { describe, expect, it } from "vitest";

import { hashIdempotencyRequest } from "./idempotency.js";

describe("idempotency hash", () => {
  it("hashes canonical request shape deterministically", () => {
    const a = hashIdempotencyRequest({ method: "POST", path: "/teams/t/billing/checkout", teamId: "t", planId: "team", seats: 15 });
    const b = hashIdempotencyRequest({ seats: 15, planId: "team", teamId: "t", path: "/teams/t/billing/checkout", method: "POST" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when request differs", () => {
    const a = hashIdempotencyRequest({ method: "POST", path: "/teams/t/billing/checkout", teamId: "t", planId: "team", seats: 15 });
    const c = hashIdempotencyRequest({ method: "POST", path: "/teams/t/billing/checkout", teamId: "t", planId: "team", seats: 16 });
    expect(a).not.toBe(c);
  });
});
