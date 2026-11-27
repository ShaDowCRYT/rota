import { monthlyTotal, PLANS, type PlanId } from "./proration.js";
import type { SubscriptionStatus } from "./types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const GRACE_DAYS = 5;
export const NOTICE_LEVEL_DUE = 1;
export const NOTICE_LEVEL_REMINDER = 2;
export const NOTICE_LEVEL_FINAL = 3;

export type NoticeLevel =
  | typeof NOTICE_LEVEL_DUE
  | typeof NOTICE_LEVEL_REMINDER
  | typeof NOTICE_LEVEL_FINAL;

export interface LifecycleSubscription {
  planId: PlanId;
  seats: number;
  status: SubscriptionStatus;
  periodStart: Date;
  periodEnd: Date;
  graceEndsAt: Date | null;
  lastNotice: number;
  pendingPlanId: PlanId | null;
  pendingSeats: number | null;
}

export interface RenewalQuote {
  kind: "renewal";
  planId: PlanId;
  seats: number;
  amountCents: number;
  periodStart: string;
  periodEnd: string;
}

export type LifecycleAction =
  | { type: "create_renewal_payment"; quote: RenewalQuote }
  | { type: "notify_owner"; noticeLevel: NoticeLevel }
  | { type: "restrict_access" };

export interface LifecycleTransition {
  subscription: LifecycleSubscription;
  changed: boolean;
  actions: LifecycleAction[];
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function noticeLevelsDue(current: LifecycleSubscription, now: Date): NoticeLevel[] {
  if (current.status !== "past_due" && current.status !== "restricted") {
    return [];
  }

  const dueAt = current.periodEnd.getTime();
  const target =
    now.getTime() >= dueAt + GRACE_DAYS * MS_PER_DAY
      ? NOTICE_LEVEL_FINAL
      : now.getTime() >= dueAt + 3 * MS_PER_DAY
        ? NOTICE_LEVEL_REMINDER
        : now.getTime() >= dueAt
          ? NOTICE_LEVEL_DUE
          : 0;

  const levels: NoticeLevel[] = [];
  for (let level = current.lastNotice + 1; level <= target; level += 1) {
    if (
      level === NOTICE_LEVEL_DUE ||
      level === NOTICE_LEVEL_REMINDER ||
      level === NOTICE_LEVEL_FINAL
    ) {
      levels.push(level);
    }
  }
  return levels;
}

function isChanged(before: LifecycleSubscription, after: LifecycleSubscription): boolean {
  return (
    before.status !== after.status ||
    before.lastNotice !== after.lastNotice ||
    before.graceEndsAt?.getTime() !== after.graceEndsAt?.getTime()
  );
}

export function nextState(input: {
  subscription: LifecycleSubscription;
  now: Date;
}): LifecycleTransition {
  const original = input.subscription;
  let current: LifecycleSubscription = { ...original };
  const actions: LifecycleAction[] = [];

  if (current.status === "active" && input.now.getTime() >= current.periodEnd.getTime()) {
    const planId = current.pendingPlanId ?? current.planId;
    const seats = current.pendingSeats ?? current.seats;
    const periodStart = current.periodEnd;
    const periodEnd = addDays(periodStart, 30);

    current = {
      ...current,
      status: "past_due",
      graceEndsAt: addDays(current.periodEnd, GRACE_DAYS),
      lastNotice: 0,
    };
    actions.push({
      type: "create_renewal_payment",
      quote: {
        kind: "renewal",
        planId,
        seats,
        amountCents: monthlyTotal(PLANS[planId], seats),
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
      },
    });
  }

  if (
    current.status === "past_due" &&
    input.now.getTime() >= (current.graceEndsAt ?? addDays(current.periodEnd, GRACE_DAYS)).getTime()
  ) {
    current = { ...current, status: "restricted" };
    actions.push({ type: "restrict_access" });
  }

  const notices = noticeLevelsDue(current, input.now);
  for (const noticeLevel of notices) {
    actions.push({ type: "notify_owner", noticeLevel });
  }
  if (notices.length > 0) {
    const latest = notices[notices.length - 1];
    if (latest !== undefined) {
      current = { ...current, lastNotice: latest };
    }
  }

  return {
    subscription: current,
    changed: isChanged(original, current),
    actions,
  };
}
