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

  it("upgrade Starter to Team mid-period", () => {
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

  it("upgrade Team to Business mid-period", () => {
    const quote = quoteChange({
      currentPlanId: "team",
      currentSeats: 15,
      newPlanId: "business",
      newSeats: 40,
      daysLeft: 12,
      seatsInUse: 15,
      periodEndIso,
    });

    expect(quote.kind).toBe("immediate");
    expect(quote.creditCents).toBe(2000);
    expect(quote.costCents).toBe(4800);
    expect(quote.chargeCents).toBe(2800);
    expect(quote.effectiveAt).toBe("now");
  });

  it("downgrade Team to Starter is scheduled for period end with no charge", () => {
    const quote = quoteChange({
      currentPlanId: "team",
      currentSeats: 15,
      newPlanId: "starter",
      newSeats: 5,
      daysLeft: 20,
      seatsInUse: 5,
      periodEndIso,
    });

    expect(quote.kind).toBe("scheduled");
    expect(quote.creditCents).toBe(0);
    expect(quote.costCents).toBe(0);
    expect(quote.chargeCents).toBe(0);
    expect(quote.effectiveAt).toBe(periodEndIso);
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

  it("add 3 extra seats to Team with 12 days left charges 360", () => {
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
    expect(quote.effectiveAt).toBe("now");
  });

  it("remove seats is scheduled for period end", () => {
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
    expect(quote.creditCents).toBe(0);
    expect(quote.costCents).toBe(0);
    expect(quote.chargeCents).toBe(0);
    expect(quote.effectiveAt).toBe(periodEndIso);
  });

  it("change on the first day uses a full period", () => {
    const quote = quoteChange({
      currentPlanId: "starter",
      currentSeats: 5,
      newPlanId: "team",
      newSeats: 15,
      daysLeft: 30,
      seatsInUse: 5,
      periodEndIso,
    });

    expect(quote.kind).toBe("immediate");
    expect(quote.creditCents).toBe(2000);
    expect(quote.costCents).toBe(5000);
    expect(quote.chargeCents).toBe(3000);
    expect(quote.effectiveAt).toBe("now");
  });

  it("change on the last day uses the minimum of one day", () => {
    const quote = quoteChange({
      currentPlanId: "starter",
      currentSeats: 5,
      newPlanId: "team",
      newSeats: 15,
      daysLeft: 1,
      seatsInUse: 5,
      periodEndIso,
    });

    expect(quote.kind).toBe("immediate");
    expect(quote.creditCents).toBe(66);
    expect(quote.costCents).toBe(166);
    expect(quote.chargeCents).toBe(100);
    expect(quote.effectiveAt).toBe("now");
  });

  it("two changes in one period are each computed from the state at that moment", () => {
    const first = quoteChange({
      currentPlanId: "team",
      currentSeats: 15,
      newPlanId: "team",
      newSeats: 18,
      daysLeft: 25,
      seatsInUse: 15,
      periodEndIso,
    });

    expect(first.kind).toBe("immediate");
    expect(first.creditCents).toBe(4166);
    expect(first.costCents).toBe(4916);
    expect(first.chargeCents).toBe(750);

    const second = quoteChange({
      currentPlanId: "team",
      currentSeats: 18,
      newPlanId: "business",
      newSeats: 40,
      daysLeft: 15,
      seatsInUse: 18,
      periodEndIso,
    });

    expect(second.kind).toBe("immediate");
    expect(second.creditCents).toBe(2950);
    expect(second.costCents).toBe(6000);
    expect(second.chargeCents).toBe(3050);
  });

  it("adding seats on Starter is rejected", () => {
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
    ).toThrow("Starter plan must have exactly 5 seats");
  });

  it("seats above the plan maximum are rejected", () => {
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
    ).toThrow("Plan allows at most 25 seats");

    expect(() =>
      quoteChange({
        currentPlanId: "business",
        currentSeats: 40,
        newPlanId: "business",
        newSeats: 101,
        daysLeft: 20,
        seatsInUse: 10,
        periodEndIso,
      }),
    ).toThrow("Plan allows at most 100 seats");
  });

  it("removing seats below the seats in use is rejected", () => {
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
    ).toThrow("Cannot remove seats below seats currently in use");
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

  it("covers every plan pair for daysLeft 1 to 30 with integer invariants", () => {
    const plans: PlanId[] = ["starter", "team", "business"];
    const seatsFor = (planId: PlanId): number => (planId === "starter" ? 5 : PLANS[planId].includedSeats);

    for (const currentPlanId of plans) {
      for (const newPlanId of plans) {
        for (let daysLeft = 1; daysLeft <= 30; daysLeft += 1) {
          const currentSeats = seatsFor(currentPlanId);
          const newSeats = seatsFor(newPlanId);
          const quote = quoteChange({
            currentPlanId,
            currentSeats,
            newPlanId,
            newSeats,
            daysLeft,
            seatsInUse: 1,
            periodEndIso,
          });

          expect(Number.isInteger(quote.chargeCents)).toBe(true);
          expect(Number.isInteger(quote.creditCents)).toBe(true);
          expect(Number.isInteger(quote.costCents)).toBe(true);
          expect(quote.chargeCents).toBeGreaterThanOrEqual(0);

          const oldTotal = monthlyTotal(PLANS[currentPlanId], currentSeats);
          const newTotal = monthlyTotal(PLANS[newPlanId], newSeats);
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
      }
    }
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
