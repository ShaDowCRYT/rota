import { HttpError } from "../../lib/errors.js";
import type { TransactionRunner } from "../../db/types.js";
import { monthlyTotal, PLANS, quoteChange, type PlanId } from "./proration.js";
import type { BillingRepository, BillingService, BillingStatus } from "./types.js";

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
  };
}

export interface BillingServiceDeps {
  repository: BillingRepository;
  transactions: TransactionRunner;
  now: () => Date;
  redis?: RedisLock;
}

const releaseLockScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export function createBillingService(deps: BillingServiceDeps): BillingService {
  async function getStatus(teamId: string): Promise<BillingStatus> {
    const [subscription, seatsUsed] = await Promise.all([
      deps.repository.getSubscription(teamId),
      deps.repository.countSeatsUsed(teamId),
    ]);

    if (subscription === undefined) {
      return toStatus("starter", "none", 5, seatsUsed, null, null, null, null);
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
    );
  }

  return {
    async getPlans() {
      return deps.repository.listPlans();
    },

    getStatus,

    async quoteChange(teamId, input) {
      const [status, subscription] = await Promise.all([
        getStatus(teamId),
        deps.repository.getSubscription(teamId),
      ]);

      const periodStart = subscription?.periodStart ?? deps.now();
      const periodEnd =
        subscription?.periodEnd ?? new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);
      const daysLeft = Math.max(
        1,
        30 - Math.floor((deps.now().getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)),
      );

      return quoteChange({
        currentPlanId: status.planId,
        currentSeats: status.seats,
        newPlanId: input.newPlanId,
        newSeats: input.newSeats,
        daysLeft,
        seatsInUse: status.seatsUsed,
        periodEndIso: periodEnd.toISOString(),
      });
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
  };
}
