import type {
  BillingRepository,
  LedgerEntryRow,
  PlanRow,
  SubscriptionRow,
} from "../modules/billing/types.js";
import { PLANS, type PlanId } from "../modules/billing/proration.js";
import type { SqlExecutor } from "../db/types.js";
import type { Database } from "../db/client.js";
import type { IdempotencyRepository, IdempotencyRecord } from "../modules/billing/idempotency.js";
import type { PaymentRow } from "../modules/billing/paymentRepository.js";

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

export class FakePaymentRepository {
  readonly payments: PaymentRow[] = [];
  async createPayment(_executor: SqlExecutor, row: Omit<PaymentRow, "createdAt" | "updatedAt" | "providerTxId" | "status"> & { status?: PaymentRow["status"]; providerTxId?: string | null }): Promise<void> {
    this.payments.push({ ...row, status: row.status ?? "pending", providerTxId: row.providerTxId ?? null, createdAt: new Date(), updatedAt: new Date() } as PaymentRow);
  }
  async markPaymentFailed(_executor: SqlExecutor, txRef: string): Promise<void> {
    const p = this.payments.find((x) => x.txRef === txRef && x.status === "pending");
    if (p) p.status = "failed";
  }
  async getLatestPayment(teamId: string): Promise<PaymentRow | undefined> {
    return [...this.payments].reverse().find((p) => p.teamId === teamId);
  }
  async getPaymentByTxRef(_executor: SqlExecutor, txRef: string): Promise<PaymentRow | undefined> {
    return this.payments.find((p) => p.txRef === txRef);
  }
}

export class FakeIdempotencyRepository implements IdempotencyRepository {
  readonly rows = new Map<string, IdempotencyRecord>();
  key(userId: string, key: string) { return `${userId}:${key}`; }
  async insertInProgress(_db: Database, userId: string, key: string, requestHash: string): Promise<boolean> {
    const k = this.key(userId, key);
    if (this.rows.has(k)) return false;
    this.rows.set(k, { status: "in_progress", requestHash, responseStatus: null, responseBody: null });
    return true;
  }
  async get(_db: Database, userId: string, key: string): Promise<IdempotencyRecord | undefined> {
    return this.rows.get(this.key(userId, key));
  }
  async markCompleted(_db: Database, userId: string, key: string, requestHash: string, responseStatus: number, responseBody: unknown): Promise<void> {
    const k = this.key(userId, key);
    const row = this.rows.get(k);
    if (row && row.requestHash === requestHash) this.rows.set(k, { ...row, status: "completed", responseStatus, responseBody });
  }
  async deleteInProgress(_db: Database, userId: string, key: string, requestHash: string): Promise<void> {
    const k = this.key(userId, key);
    const row = this.rows.get(k);
    if (row && row.requestHash === requestHash && row.status === "in_progress") this.rows.delete(k);
  }
}
