import { randomUUID } from "node:crypto";

import { HttpError } from "../../lib/errors.js";
import type { TransactionRunner } from "../../db/types.js";
import type { PaymentProvider } from "../../providers/payments/types.js";
import { monthlyTotal, PLANS, quoteChange, type PlanId } from "./proration.js";
import type {
  BillingRepository,
  BillingService,
  BillingStatus,
  CheckoutRequest,
  CheckoutResult,
  ScheduleChangeResult,
} from "./types.js";
import type { createPaymentRepository } from "./paymentRepository.js";

type PaymentRepository = ReturnType<typeof createPaymentRepository>;
import type { IdempotencyRepository } from "./idempotency.js";
import { beginIdempotentRequest } from "./idempotency.js";
import type { ActivityService } from "../activity/types.js";
import type { Database } from "../../db/client.js";

interface RedisLock {
  set(key: string, value: string, mode: "EX", seconds: number, nx: "NX"): Promise<unknown>;
  eval(script: string, keys: readonly string[], args: readonly (string | number)[]): Promise<unknown>;
}

function toStatus(
  planId: PlanId,
  status: BillingStatus["status"],
  seats: number,
  seatsUsed: number,
  periodStart: Date | null,
  periodEnd: Date | null,
  pendingPlanId: PlanId | null,
  pendingSeats: number | null,
  latestPaymentStatus: BillingStatus["latestPaymentStatus"],
): BillingStatus {
  const plan = PLANS[planId];
  return {
    planId,
    planName: plan.id.charAt(0).toUpperCase() + plan.id.slice(1),
    status,
    seats,
    seatsUsed,
    periodStart: periodStart?.toISOString() ?? null,
    periodEnd: periodEnd?.toISOString() ?? null,
    pendingPlanId,
    pendingSeats,
    monthlyTotalCents: monthlyTotal(plan, seats),
    latestPaymentStatus,
  };
}

export interface BillingServiceDeps {
  repository: BillingRepository;
  paymentRepository: PaymentRepository;
  idempotencyRepository: IdempotencyRepository;
  globalDb: Database;
  provider?: PaymentProvider;
  paymentsEnabled: boolean;
  currency: string;
  publicApiUrl?: string;
  transactions: TransactionRunner;
  now: () => Date;
  redis?: RedisLock;
  activity?: ActivityService;
}

const releaseLockScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export function createBillingService(deps: BillingServiceDeps): BillingService {
  async function getStatus(teamId: string): Promise<BillingStatus> {
    const [subscription, seatsUsed, latestPayment] = await Promise.all([
      deps.repository.getSubscription(teamId),
      deps.repository.countSeatsUsed(teamId),
      deps.paymentRepository.getLatestPayment(teamId),
    ]);

    const latestPaymentStatus = latestPayment?.status ?? null;
    if (subscription === undefined) {
      return toStatus("starter", "none", 5, seatsUsed, null, null, null, null, latestPaymentStatus);
    }

    return toStatus(
      subscription.planId,
      subscription.status,
      subscription.seats,
      seatsUsed,
      subscription.periodStart,
      subscription.periodEnd,
      subscription.pendingPlanId,
      subscription.pendingSeats,
      latestPaymentStatus,
    );
  }

  function assertPaymentsReady(): void {
    if (!deps.paymentsEnabled || deps.provider === undefined || deps.publicApiUrl === undefined) {
      throw new HttpError(503, "Payments are not available");
    }
  }

  async function quoteForTeam(teamId: string, input: { planId: PlanId; seats: number }) {
    const [status, subscription] = await Promise.all([
      getStatus(teamId),
      deps.repository.getSubscription(teamId),
    ]);
    const periodStart = subscription?.periodStart ?? deps.now();
    const periodEnd =
      subscription?.periodEnd ?? new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);
    const quote = quoteChange({
      currentPlanId: status.planId,
      currentSeats: status.seats,
      newPlanId: input.planId,
      newSeats: input.seats,
      daysLeft: Math.max(1, 30 - Math.floor((deps.now().getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000))),
      seatsInUse: status.seatsUsed,
      periodEndIso: periodEnd.toISOString(),
    });
    return { status, subscription, quote, periodEnd };
  }

  return {
    async getPlans() {
      return deps.repository.listPlans();
    },

    getStatus,

    async quoteChange(teamId, input) {
      const { quote } = await quoteForTeam(teamId, { planId: input.newPlanId, seats: input.newSeats });
      return quote;
    },

    async assertSeatAvailable(teamId) {
      const redis = deps.redis;
      if (redis === undefined) {
        const status = await getStatus(teamId);
        if (status.seatsUsed >= status.seats) {
          throw new HttpError(409, "Seat limit reached for this plan");
        }
        return;
      }

      const key = `lock:seat:${teamId}`;
      const token = `${Date.now()}-${Math.random()}`;
      const acquired = await redis.set(key, token, "EX", 10, "NX");
      if (acquired !== "OK") {
        throw new HttpError(503, "Service unavailable");
      }

      try {
        const status = await getStatus(teamId);
        if (status.seatsUsed >= status.seats) {
          throw new HttpError(409, "Seat limit reached for this plan");
        }
      } finally {
        await redis.eval(releaseLockScript, [key], [token]).catch(() => undefined);
      }
    },

    async checkout(teamId, userId, email, idempotencyKey, input: CheckoutRequest): Promise<CheckoutResult> {
      assertPaymentsReady();
      const provider = deps.provider!;
      const publicApiUrl = deps.publicApiUrl!;

      const begun = await beginIdempotentRequest(
        deps.idempotencyRepository,
        deps.globalDb,
        userId,
        idempotencyKey,
        { method: "POST", path: `/teams/${teamId}/billing/checkout`, teamId, planId: input.planId, seats: input.seats },
      );
      if (begun.replay) {
        return begun.replay.body as CheckoutResult;
      }

      const { status, subscription, quote } = await quoteForTeam(teamId, input);
      const isInitial = status.status === "none";
      const amountCents = isInitial
        ? monthlyTotal(PLANS[input.planId], input.seats)
        : quote.chargeCents;

      if (!isInitial && quote.kind === "scheduled") {
        await deps.idempotencyRepository.deleteInProgress(deps.globalDb, userId, idempotencyKey, begun.requestHash);
        throw new HttpError(409, "This change is scheduled, use schedule-change");
      }
      if (!isInitial && amountCents <= 0) {
        await deps.idempotencyRepository.deleteInProgress(deps.globalDb, userId, idempotencyKey, begun.requestHash);
        throw new HttpError(409, "This change is scheduled, use schedule-change");
      }
      if (isInitial && subscription !== undefined && status.status !== "none") {
        await deps.idempotencyRepository.deleteInProgress(deps.globalDb, userId, idempotencyKey, begun.requestHash);
        throw new HttpError(409, "Team already has a subscription");
      }

      const paymentId = randomUUID();
      const txRef = `rota.${teamId}.${paymentId}`;
      const currency = deps.currency;

      try {
        await deps.transactions(teamId, async (executor) => {
          await deps.paymentRepository.createPayment(executor, {
            id: paymentId,
            teamId,
            txRef,
            kind: isInitial ? "initial" : "change",
            amountCents,
            currency,
            planId: input.planId,
            seats: input.seats,
            quote,
            createdBy: userId,
          });
        });

        const checkout = await provider.createCheckout({
          txRef,
          amountCents,
          currency,
          redirectUrl: `${publicApiUrl.replace(/\/$/, "")}/billing/return`,
          customerEmail: email,
          title: "Rota subscription",
          meta: { teamId, paymentId, kind: isInitial ? "initial" : "change" },
        });

        const response: CheckoutResult = { checkoutUrl: checkout.checkoutUrl, paymentId, amountCents, currency };
        await deps.idempotencyRepository.markCompleted(deps.globalDb, userId, idempotencyKey, begun.requestHash, 200, response);
        return response;
      } catch (error) {
        await deps.transactions(teamId, async (executor) => {
          await deps.paymentRepository.markPaymentFailed(executor, txRef);
        }).catch(() => undefined);
        await deps.idempotencyRepository.deleteInProgress(deps.globalDb, userId, idempotencyKey, begun.requestHash).catch(() => undefined);
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, "Payment provider unavailable");
      }
    },

    async scheduleChange(teamId, userId, idempotencyKey, input: CheckoutRequest): Promise<ScheduleChangeResult> {
      const begun = await beginIdempotentRequest(
        deps.idempotencyRepository,
        deps.globalDb,
        userId,
        idempotencyKey,
        { method: "POST", path: `/teams/${teamId}/billing/schedule-change`, teamId, planId: input.planId, seats: input.seats },
      );
      if (begun.replay) {
        return begun.replay.body as ScheduleChangeResult;
      }

      try {
        const { status, quote, periodEnd } = await quoteForTeam(teamId, input);
        if (status.status === "none" || quote.kind !== "scheduled") {
          await deps.idempotencyRepository.deleteInProgress(deps.globalDb, userId, idempotencyKey, begun.requestHash);
          throw new HttpError(409, "This change is not schedulable");
        }

        const effectiveAt = periodEnd.toISOString();
        await deps.transactions(teamId, async (executor) => {
          await deps.repository.upsertSubscription(executor, {
            teamId,
            planId: status.planId,
            seats: status.seats,
            periodStart: new Date(status.periodStart ?? deps.now().toISOString()),
            periodEnd,
            status: status.status,
            pendingPlanId: input.planId,
            pendingSeats: input.seats,
          });
          await deps.repository.appendLedgerEntry(executor, {
            teamId,
            type: input.planId !== status.planId ? "plan_change" : "seat_change",
            amountCents: 0,
            currency: deps.currency,
            ref: `schedule:${teamId}:${input.planId}:${input.seats}`,
            planId: input.planId,
            seats: input.seats,
            periodStart: periodEnd,
            periodEnd: null,
            idempotencyRef: `schedule:${idempotencyKey}`,
          });
        });

        const response: ScheduleChangeResult = {
          status: "scheduled",
          pendingPlanId: input.planId,
          pendingSeats: input.seats,
          effectiveAt,
        };
        await deps.idempotencyRepository.markCompleted(deps.globalDb, userId, idempotencyKey, begun.requestHash, 200, response);
        return response;
      } catch (error) {
        await deps.idempotencyRepository.deleteInProgress(deps.globalDb, userId, idempotencyKey, begun.requestHash).catch(() => undefined);
        throw error;
      }
    },
  };
}
