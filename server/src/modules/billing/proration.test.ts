import { describe, expect, it } from "vitest";

import {
  daysLeftInPeriod,
  monthlyTotal,
  PLANS,
  quoteChange,
  type PlanId,
} from "./proration.js";

describe("monthlyTotal", () => {
  it("computes plan totals in cents", () => {
    expect(monthlyTotal(PLANS.starter, 5)).toBe(2000);
    expect(monthlyTotal(PLANS.team, 15)).toBe(5000);
    expect(monthlyTotal(PLANS.team, 18)).toBe(5900);
    expect(monthlyTotal(PLANS.business, 40)).toBe(12000);
    expect(monthlyTotal(PLANS.business, 45)).toBe(13000);
  });
});

describe("daysLeftInPeriod", () => {
  it("uses max(1, 30 - elapsed whole days)", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(daysLeftInPeriod(new Date("2026-01-01T00:00:00.000Z"), start)).toBe(30);
    expect(daysLeftInPeriod(new Date("2026-01-10T23:59:59.000Z"), start)).toBe(21);
    expect(daysLeftInPeriod(new Date("2026-01-11T00:00:00.000Z"), start)).toBe(20);
    expect(daysLeftInPeriod(new Date("2026-01-31T00:00:00.000Z"), start)).toBe(1);
    expect(daysLeftInPeriod(new Date("2026-02-15T00:00:00.000Z"), start)).toBe(1);
  });
});

describe("quoteChange", () => {
  const periodEndIso = "2026-02-01T00:00:00.000Z";

  it("returns exact PRD upgrade proof", () => {
    const quote = quoteChange({
      currentPlanId: "starter",
      currentSeats: 5,
      newPlanId: "team",
      newSeats: 15,
      daysLeft: 20,
      seatsInUse: 5,
      periodEndIso,
    });

    expect(quote.kind).toBe("immediate");
    expect(quote.creditCents).toBe(1333);
    expect(quote.costCents).toBe(3333);
    expect(quote.chargeCents).toBe(2000);
    expect(quote.effectiveAt).toBe("now");
  });

  it("returns exact PRD added-seat proof", () => {
    const quote = quoteChange({
      currentPlanId: "team",
      currentSeats: 15,
      newPlanId: "team",
      newSeats: 18,
      daysLeft: 12,
      seatsInUse: 15,
      periodEndIso,
    });

    expect(quote.kind).toBe("immediate");
    expect(quote.creditCents).toBe(2000);
    expect(quote.costCents).toBe(2360);
    expect(quote.chargeCents).toBe(360);
  });

  it("schedules downgrades at period end with no refund", () => {
    const quote = quoteChange({
      currentPlanId: "team",
      currentSeats: 18,
      newPlanId: "starter",
      newSeats: 5,
      daysLeft: 20,
      seatsInUse: 5,
      periodEndIso,
    });

    expect(quote.kind).toBe("scheduled");
    expect(quote.chargeCents).toBe(0);
    expect(quote.creditCents).toBe(0);
    expect(quote.costCents).toBe(0);
    expect(quote.effectiveAt).toBe(periodEndIso);
  });

  it("schedules seat removals at period end", () => {
    const quote = quoteChange({
      currentPlanId: "team",
      currentSeats: 18,
      newPlanId: "team",
      newSeats: 15,
      daysLeft: 12,
      seatsInUse: 10,
      periodEndIso,
    });

    expect(quote.kind).toBe("scheduled");
    expect(quote.chargeCents).toBe(0);
    expect(quote.effectiveAt).toBe(periodEndIso);
  });

  it("rejects invalid changes", () => {
    expect(() =>
      quoteChange({
        currentPlanId: "starter",
        currentSeats: 5,
        newPlanId: "team",
        newSeats: 14,
        daysLeft: 20,
        seatsInUse: 5,
        periodEndIso,
      }),
    ).toThrow(/15 seats/);

    expect(() =>
      quoteChange({
        currentPlanId: "team",
        currentSeats: 15,
        newPlanId: "team",
        newSeats: 26,
        daysLeft: 20,
        seatsInUse: 10,
        periodEndIso,
      }),
    ).toThrow(/at most 25/);

    expect(() =>
      quoteChange({
        currentPlanId: "starter",
        currentSeats: 5,
        newPlanId: "starter",
        newSeats: 6,
        daysLeft: 20,
        seatsInUse: 5,
        periodEndIso,
      }),
    ).toThrow(/exactly 5/);

    expect(() =>
      quoteChange({
        currentPlanId: "team",
        currentSeats: 20,
        newPlanId: "team",
        newSeats: 15,
        daysLeft: 20,
        seatsInUse: 16,
        periodEndIso,
      }),
    ).toThrow(/seats currently in use/);
  });

  it("keeps property invariants over valid random-ish cases", () => {
    const plans: PlanId[] = ["starter", "team", "business"];
    let seed = 42;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 500; i += 1) {
      const currentPlanId = plans[Math.floor(next() * plans.length)]!;
      const newPlanId = plans[Math.floor(next() * plans.length)]!;
      const currentPlan = PLANS[currentPlanId];
      const newPlan = PLANS[newPlanId];
      const currentSeats =
        currentPlan.extraSeatCents === null
          ? 5
          : currentPlan.includedSeats + Math.floor(next() * (currentPlan.maxSeats - currentPlan.includedSeats + 1));
      const newSeats =
        newPlan.extraSeatCents === null
          ? 5
          : newPlan.includedSeats + Math.floor(next() * (newPlan.maxSeats - newPlan.includedSeats + 1));
      const seatsInUse = Math.min(currentSeats, newSeats, Math.floor(next() * newSeats) + 1);
      const daysLeft = Math.floor(next() * 30) + 1;

      const quote = quoteChange({
        currentPlanId,
        currentSeats,
        newPlanId,
        newSeats,
        daysLeft,
        seatsInUse,
        periodEndIso,
      });

      expect(Number.isInteger(quote.chargeCents)).toBe(true);
      expect(Number.isInteger(quote.creditCents)).toBe(true);
      expect(Number.isInteger(quote.costCents)).toBe(true);
      expect(quote.chargeCents).toBeGreaterThanOrEqual(0);

      const oldTotal = monthlyTotal(currentPlan, currentSeats);
      const newTotal = monthlyTotal(newPlan, newSeats);
      if (newTotal < oldTotal) {
        expect(quote.kind).toBe("scheduled");
        expect(quote.chargeCents).toBe(0);
        expect(quote.effectiveAt).toBe(periodEndIso);
      } else {
        expect(quote.kind).toBe("immediate");
        expect(quote.creditCents).toBe(Math.floor((oldTotal * daysLeft) / 30));
        expect(quote.costCents).toBe(Math.floor((newTotal * daysLeft) / 30));
        expect(quote.chargeCents).toBe(quote.costCents - quote.creditCents);
      }
    }
  });
});
