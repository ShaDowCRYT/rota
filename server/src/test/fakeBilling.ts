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
  readonly ownerIdsByTeam = new Map<string, string>();
  readonly emailsByUser = new Map<string, string>();
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

  async getTeamOwnerId(teamId: string): Promise<string | undefined> {
    return this.ownerIdsByTeam.get(teamId);
  }

  async getOwnerEmail(userId: string): Promise<string | undefined> {
    return this.emailsByUser.get(userId);
  }

  async listSubscriptionsForMaintenance(now: Date, limit: number): Promise<SubscriptionRow[]> {
    return [...this.subscriptions.values()]
      .filter((row) => (row.status === "active" || row.status === "past_due") && (row.periodEnd.getTime() <= now.getTime() || (row.graceEndsAt?.getTime() ?? Infinity) <= now.getTime()))
      .sort((a, b) => a.periodEnd.getTime() - b.periodEnd.getTime())
      .slice(0, limit);
  }
}

export class FakePaymentRepository {
  readonly payments: PaymentRow[] = [];

  private find(txRef: string): PaymentRow | undefined {
    return this.payments.find((payment) => payment.txRef === txRef);
  }

  async createPayment(
    _executor: SqlExecutor,
    row: Omit<PaymentRow, "createdAt" | "updatedAt" | "providerTxId" | "status" | "checkoutUrl"> & {
      status?: PaymentRow["status"];
      providerTxId?: string | null;
      checkoutUrl?: string | null;
    },
  ): Promise<void> {
    this.payments.push({
      ...row,
      status: row.status ?? "pending",
      providerTxId: row.providerTxId ?? null,
      checkoutUrl: row.checkoutUrl ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async insertRenewalPaymentIfMissing(
    _executor: SqlExecutor,
    row: Omit<PaymentRow, "createdAt" | "updatedAt" | "providerTxId" | "status" | "checkoutUrl">,
  ): Promise<boolean> {
    if (this.find(row.txRef) !== undefined) return false;
    await this.createPayment(_executor, { ...row, kind: "renewal" });
    return true;
  }

  async markPaymentFailed(_executor: SqlExecutor, txRef: string): Promise<void> {
    const payment = this.find(txRef);
    if (payment?.status === "pending") payment.status = "failed";
  }

  async markPaymentSucceeded(
    _executor: SqlExecutor,
    txRef: string,
    providerTxId: string,
  ): Promise<boolean> {
    const payment = this.find(txRef);
    if (payment === undefined || (payment.status !== "pending" && payment.status !== "expired")) {
      return false;
    }
    payment.status = "succeeded";
    payment.providerTxId = providerTxId;
    return true;
  }

  async markPaymentFailedForVerification(
    _executor: SqlExecutor,
    txRef: string,
    providerTxId: string,
  ): Promise<boolean> {
    const payment = this.find(txRef);
    if (payment === undefined || (payment.status !== "pending" && payment.status !== "expired")) {
      return false;
    }
    payment.status = "failed";
    payment.providerTxId = providerTxId;
    return true;
  }

  async updatePaymentQuote(_executor: SqlExecutor, txRef: string, quote: unknown): Promise<void> {
    const payment = this.find(txRef);
    if (payment !== undefined) payment.quote = quote;
  }

  async setCheckoutUrl(teamId: string, paymentId: string, checkoutUrl: string): Promise<boolean> {
    const payment = this.payments.find((row) => row.teamId === teamId && row.id === paymentId && row.checkoutUrl === null);
    if (payment === undefined) return false;
    payment.checkoutUrl = checkoutUrl;
    return true;
  }

  async getLatestPayment(teamId: string): Promise<PaymentRow | undefined> {
    return [...this.payments].reverse().find((payment) => payment.teamId === teamId);
  }

  async getLatestRenewalPayment(teamId: string): Promise<PaymentRow | undefined> {
    return [...this.payments].reverse().find((payment) => payment.teamId === teamId && payment.kind === "renewal");
  }

  async getPaymentById(teamId: string, paymentId: string): Promise<PaymentRow | undefined> {
    return this.payments.find((payment) => payment.teamId === teamId && payment.id === paymentId);
  }

  async getPaymentByTxRef(_executor: SqlExecutor, txRef: string): Promise<PaymentRow | undefined> {
    return this.find(txRef);
  }

  async listPendingRenewals(before: Date, limit: number): Promise<PaymentRow[]> {
    return this.payments
      .filter((payment) => payment.kind === "renewal" && payment.status === "pending" && payment.updatedAt.getTime() <= before.getTime())
      .slice(0, limit);
  }

  async listRenewalsNeedingCheckout(before: Date, limit: number): Promise<PaymentRow[]> {
    return this.payments
      .filter((payment) => payment.kind === "renewal" && payment.status === "pending" && payment.checkoutUrl === null && payment.updatedAt.getTime() <= before.getTime())
      .slice(0, limit);
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
