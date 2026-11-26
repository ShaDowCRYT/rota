import { describe, expect, it } from "vitest";

import { createBillingService } from "./service.js";
import { FakeBillingRepository } from "../../test/fakeBilling.js";
import { testTransactionRunner } from "../../test/helpers.js";

describe("billing service seat limits", () => {
  it("treats missing subscription as Starter with 5 seats", async () => {
    const repo = new FakeBillingRepository();
    repo.seatsUsedByTeam.set("team-1", 4);
    const service = createBillingService({
      repository: repo,
      transactions: testTransactionRunner,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const status = await service.getStatus("team-1");
    expect(status.status).toBe("none");
    expect(status.planId).toBe("starter");
    expect(status.seats).toBe(5);
    await expect(service.assertSeatAvailable("team-1")).resolves.toBeUndefined();

    repo.seatsUsedByTeam.set("team-1", 5);
    await expect(service.assertSeatAvailable("team-1")).rejects.toMatchObject({
      status: 409,
      message: "Seat limit reached for this plan",
    });
  });
});
