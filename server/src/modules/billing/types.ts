import type { SqlExecutor } from "../../db/types.js";
import type { PlanId } from "./proration.js";

export type SubscriptionStatus = "none" | "active" | "past_due" | "restricted";
export type LedgerEntryType =
  | "charge"
  | "credit"
  | "refund"
  | "adjustment"
  | "plan_change"
  | "seat_change"
  | "renewal";

export interface PlanRow {
  id: PlanId;
  name: string;
  priceCents: number;
  includedSeats: number;
  extraSeatCents: number | null;
  maxSeats: number;
}

export interface SubscriptionRow {
  teamId: string;
  planId: PlanId;
  seats: number;
  periodStart: Date;
  periodEnd: Date;
  status: SubscriptionStatus;
  pendingPlanId: PlanId | null;
  pendingSeats: number | null;
  updatedAt: Date;
}

export interface LedgerEntryRow {
  id: string;
  teamId: string;
  type: LedgerEntryType;
  amountCents: number;
  currency: string;
  ref: string;
  planId: PlanId | null;
  seats: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  idempotencyRef: string | null;
  createdAt: Date;
}

export interface BillingStatus {
  planId: PlanId;
  planName: string;
  status: SubscriptionStatus;
  seats: number;
  seatsUsed: number;
  periodStart: string | null;
  periodEnd: string | null;
  pendingPlanId: PlanId | null;
  pendingSeats: number | null;
  monthlyTotalCents: number;
  latestPaymentStatus: "pending" | "succeeded" | "failed" | "expired" | null;
}

export interface BillingRepository {
  listPlans(): Promise<PlanRow[]>;
  findPlan(planId: PlanId): Promise<PlanRow | undefined>;
  getSubscription(teamId: string, executor?: SqlExecutor): Promise<SubscriptionRow | undefined>;
  upsertSubscription(
    executor: SqlExecutor,
    input: Omit<SubscriptionRow, "updatedAt">,
  ): Promise<void>;
  appendLedgerEntry(
    executor: SqlExecutor,
    input: Omit<LedgerEntryRow, "id" | "createdAt"> & { id?: string },
  ): Promise<LedgerEntryRow>;
  listLedgerEntries(teamId: string): Promise<LedgerEntryRow[]>;
  countSeatsUsed(teamId: string): Promise<number>;
}

export interface QuoteRequest {
  newPlanId: PlanId;
  newSeats: number;
}

export interface CheckoutRequest {
  planId: PlanId;
  seats: number;
}

export interface CheckoutResult {
  checkoutUrl: string;
  paymentId: string;
  amountCents: number;
  currency: string;
}

export interface ScheduleChangeResult {
  status: "scheduled";
  pendingPlanId: PlanId;
  pendingSeats: number;
  effectiveAt: string;
}

export interface BillingService {
  getPlans(): Promise<PlanRow[]>;
  getStatus(teamId: string): Promise<BillingStatus>;
  quoteChange(teamId: string, input: QuoteRequest): Promise<import("./proration.js").QuoteResult>;
  assertSeatAvailable(teamId: string): Promise<void>;
  checkout(
    teamId: string,
    userId: string,
    email: string,
    idempotencyKey: string,
    input: CheckoutRequest,
  ): Promise<CheckoutResult>;
  scheduleChange(
    teamId: string,
    userId: string,
    idempotencyKey: string,
    input: CheckoutRequest,
  ): Promise<ScheduleChangeResult>;
}
