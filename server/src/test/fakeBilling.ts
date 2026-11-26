import type {
  BillingRepository,
  LedgerEntryRow,
  PlanRow,
  SubscriptionRow,
} from "../modules/billing/types.js";
import { PLANS, type PlanId } from "../modules/billing/proration.js";
import type { SqlExecutor } from "../db/types.js";

export class FakeBillingRepository implements BillingRepository {
  readonly plans: PlanRow[] = Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.id.charAt(0).toUpperCase() + p.id.slice(1),
    priceCents: p.priceCents,
    includedSeats: p.includedSeats,
    extraSeatCents: p.extraSeatCents,
    maxSeats: p.maxSeats,
  }));
  readonly subscriptions = new Map<string, SubscriptionRow>();
  readonly ledger: LedgerEntryRow[] = [];
  seatsUsedByTeam = new Map<string, number>();

  async listPlans(): Promise<PlanRow[]> {
    return this.plans;
  }

  async findPlan(planId: PlanId): Promise<PlanRow | undefined> {
    return this.plans.find((p) => p.id === planId);
  }

  async getSubscription(teamId: string, _executor?: SqlExecutor): Promise<SubscriptionRow | undefined> {
    return this.subscriptions.get(teamId);
  }

  async upsertSubscription(
    _executor: SqlExecutor,
    input: Omit<SubscriptionRow, "updatedAt">,
  ): Promise<void> {
    this.subscriptions.set(input.teamId, { ...input, updatedAt: new Date() });
  }

  async appendLedgerEntry(
    _executor: SqlExecutor,
    input: Omit<LedgerEntryRow, "id" | "createdAt"> & { id?: string },
  ): Promise<LedgerEntryRow> {
    const row: LedgerEntryRow = {
      id: input.id ?? `ledger-${this.ledger.length + 1}`,
      createdAt: new Date(),
      ...input,
    };
    this.ledger.push(row);
    return row;
  }

  async listLedgerEntries(teamId: string): Promise<LedgerEntryRow[]> {
    return this.ledger.filter((e) => e.teamId === teamId);
  }

  async countSeatsUsed(teamId: string): Promise<number> {
    return this.seatsUsedByTeam.get(teamId) ?? 0;
  }
}
