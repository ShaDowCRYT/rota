import { HttpError } from "../../lib/errors.js";

export type PlanId = "starter" | "team" | "business";
export type ChangeKind = "immediate" | "scheduled";

export interface PlanConfig {
  id: PlanId;
  priceCents: number;
  includedSeats: number;
  extraSeatCents: number | null;
  maxSeats: number;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  starter: {
    id: "starter",
    priceCents: 2000,
    includedSeats: 5,
    extraSeatCents: null,
    maxSeats: 5,
  },
  team: {
    id: "team",
    priceCents: 5000,
    includedSeats: 15,
    extraSeatCents: 300,
    maxSeats: 25,
  },
  business: {
    id: "business",
    priceCents: 12000,
    includedSeats: 40,
    extraSeatCents: 200,
    maxSeats: 100,
  },
};

export const PLAN_ORDER: PlanId[] = ["starter", "team", "business"];

export interface QuoteInput {
  currentPlanId: PlanId;
  currentSeats: number;
  newPlanId: PlanId;
  newSeats: number;
  daysLeft: number;
  seatsInUse: number;
  periodEndIso: string;
}

export interface QuoteResult {
  kind: ChangeKind;
  chargeCents: number;
  creditCents: number;
  costCents: number;
  newPlanId: PlanId;
  newSeats: number;
  effectiveAt: string;
  daysLeft: number;
  breakdown: {
    oldMonthlyTotalCents: number;
    newMonthlyTotalCents: number;
  };
}

export class BillingError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.status = status;
  }
}

export function toHttpError(error: unknown): HttpError | undefined {
  if (error instanceof BillingError) {
    return new HttpError(error.status, error.message);
  }
  return undefined;
}

export function monthlyTotal(plan: PlanConfig, seats: number): number {
  const extraSeats = Math.max(0, seats - plan.includedSeats);
  const extra = plan.extraSeatCents === null ? 0 : extraSeats * plan.extraSeatCents;
  return plan.priceCents + extra;
}

export function daysLeftInPeriod(now: Date, periodStart: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const elapsedDays = Math.floor((now.getTime() - periodStart.getTime()) / msPerDay);
  return Math.max(1, 30 - elapsedDays);
}

function assertInteger(value: number, code: string, message: string): void {
  if (!Number.isInteger(value)) {
    throw new BillingError(code, message);
  }
}

export function quoteChange(input: QuoteInput): QuoteResult {
  const currentPlan = PLANS[input.currentPlanId];
  const newPlan = PLANS[input.newPlanId];
  if (currentPlan === undefined || newPlan === undefined) {
    throw new BillingError("invalid_plan", "Unknown plan");
  }

  assertInteger(input.currentSeats, "invalid_seats", "Seats must be a whole number");
  assertInteger(input.newSeats, "invalid_seats", "Seats must be a whole number");
  assertInteger(input.daysLeft, "invalid_days_left", "daysLeft must be a whole number");
  assertInteger(input.seatsInUse, "invalid_seats_in_use", "seatsInUse must be a whole number");

  if (input.daysLeft < 1 || input.daysLeft > 30) {
    throw new BillingError("invalid_days_left", "daysLeft must be between 1 and 30");
  }
  if (input.newSeats < 1) {
    throw new BillingError("invalid_seats", "Seats must be at least 1");
  }
  if (newPlan.extraSeatCents === null && input.newSeats !== newPlan.includedSeats) {
    throw new BillingError("starter_seats_fixed", "Starter plan must have exactly 5 seats");
  }
  if (input.newSeats > newPlan.maxSeats) {
    throw new BillingError("seat_limit_exceeded", `Plan allows at most ${newPlan.maxSeats} seats`);
  }
  if (input.newSeats < newPlan.includedSeats) {
    throw new BillingError(
      "seats_below_included",
      `Plan includes ${newPlan.includedSeats} seats`,
    );
  }
  if (newPlan.extraSeatCents === null && input.newSeats > newPlan.includedSeats) {
    throw new BillingError("starter_no_extra_seats", "Starter plan cannot add extra seats");
  }
  if (input.newSeats < input.seatsInUse) {
    throw new BillingError(
      "seats_below_in_use",
      "Cannot remove seats below seats currently in use",
    );
  }

  const oldMonthlyTotalCents = monthlyTotal(currentPlan, input.currentSeats);
  const newMonthlyTotalCents = monthlyTotal(newPlan, input.newSeats);
  const creditCents = Math.floor((oldMonthlyTotalCents * input.daysLeft) / 30);
  const costCents = Math.floor((newMonthlyTotalCents * input.daysLeft) / 30);

  const isDowngrade = newMonthlyTotalCents < oldMonthlyTotalCents;
  const kind: ChangeKind = isDowngrade ? "scheduled" : "immediate";
  const chargeCents = kind === "immediate" ? costCents - creditCents : 0;

  return {
    kind,
    chargeCents,
    creditCents: kind === "immediate" ? creditCents : 0,
    costCents: kind === "immediate" ? costCents : 0,
    newPlanId: input.newPlanId,
    newSeats: input.newSeats,
    effectiveAt: kind === "immediate" ? "now" : input.periodEndIso,
    daysLeft: input.daysLeft,
    breakdown: {
      oldMonthlyTotalCents,
      newMonthlyTotalCents,
    },
  };
}
