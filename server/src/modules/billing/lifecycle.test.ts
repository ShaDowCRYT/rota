import { describe, expect, it, vi } from "vitest";

import {
  GRACE_DAYS,
  nextState,
  type LifecycleSubscription,
} from "./lifecycle.js";

const periodEnd = new Date("2026-02-01T00:00:00.000Z");

function subscription(overrides: Partial<LifecycleSubscription> = {}): LifecycleSubscription {
  return {
    planId: "team",
    seats: 15,
    status: "active",
    periodStart: new Date("2026-01-02T00:00:00.000Z"),
    periodEnd,
    graceEndsAt: null,
    lastNotice: 0,
    pendingPlanId: null,
    pendingSeats: null,
    ...overrides,
  };
}

function dayAfterPeriodEnd(days: number): Date {
  return new Date(periodEnd.getTime() + days * 24 * 60 * 60 * 1000);
}

describe("billing lifecycle", () => {
  it("keeps an active subscription unchanged before period end", () => {
    const current = subscription();
    const transition = nextState({
      subscription: current,
      now: dayAfterPeriodEnd(-1),
    });

    expect(transition.changed).toBe(false);
    expect(transition.actions).toEqual([]);
    expect(transition.subscription).toEqual(current);
  });

  it("expires an active subscription and opens a renewal payment", () => {
    const transition = nextState({
      subscription: subscription(),
      now: periodEnd,
    });

    expect(transition.subscription.status).toBe("past_due");
    expect(transition.subscription.graceEndsAt?.toISOString()).toBe(
      dayAfterPeriodEnd(GRACE_DAYS).toISOString(),
    );
    expect(transition.subscription.lastNotice).toBe(1);
    expect(transition.actions).toEqual([
      {
        type: "create_renewal_payment",
        quote: {
          kind: "renewal",
          planId: "team",
          seats: 15,
          amountCents: 5000,
          periodStart: periodEnd.toISOString(),
          periodEnd: new Date("2026-03-03T00:00:00.000Z").toISOString(),
        },
      },
      { type: "notify_owner", noticeLevel: 1 },
    ]);
  });

  it("renews with pending plan and seats at the full monthly total", () => {
    const transition = nextState({
      subscription: subscription({
        pendingPlanId: "business",
        pendingSeats: 42,
      }),
      now: periodEnd,
    });

    expect(transition.actions[0]).toEqual({
      type: "create_renewal_payment",
      quote: {
        kind: "renewal",
        planId: "business",
        seats: 42,
        amountCents: 12400,
        periodStart: periodEnd.toISOString(),
        periodEnd: new Date("2026-03-03T00:00:00.000Z").toISOString(),
      },
    });
  });

  it("sends only the missed day-three notice when it has not been sent", () => {
    const transition = nextState({
      subscription: subscription({
        status: "past_due",
        graceEndsAt: dayAfterPeriodEnd(GRACE_DAYS),
        lastNotice: 1,
      }),
      now: dayAfterPeriodEnd(3),
    });

    expect(transition.subscription.status).toBe("past_due");
    expect(transition.subscription.lastNotice).toBe(2);
    expect(transition.actions).toEqual([{ type: "notify_owner", noticeLevel: 2 }]);
  });

  it("restricts access and sends all missed notices at day five", () => {
    const transition = nextState({
      subscription: subscription({
        status: "past_due",
        graceEndsAt: dayAfterPeriodEnd(GRACE_DAYS),
        lastNotice: 1,
      }),
      now: dayAfterPeriodEnd(5),
    });

    expect(transition.subscription.status).toBe("restricted");
    expect(transition.subscription.lastNotice).toBe(3);
    expect(transition.actions).toEqual([
      { type: "restrict_access" },
      { type: "notify_owner", noticeLevel: 2 },
      { type: "notify_owner", noticeLevel: 3 },
    ]);
  });

  it("leaves a restricted subscription unchanged", () => {
    const current = subscription({
      status: "restricted",
      graceEndsAt: dayAfterPeriodEnd(GRACE_DAYS),
      lastNotice: 3,
    });
    const transition = nextState({ subscription: current, now: dayAfterPeriodEnd(9) });

    expect(transition.changed).toBe(false);
    expect(transition.actions).toEqual([]);
  });

  it("does not read the real clock", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
    try {
      nextState({ subscription: subscription(), now: periodEnd });
      expect(nowSpy).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });
});
