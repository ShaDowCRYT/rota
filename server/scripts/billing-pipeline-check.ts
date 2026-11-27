import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { Redis } from "ioredis";

import { createDb } from "../src/db/client.js";
import { configureShards, getShardFor } from "../src/db/shard.js";
import { runShardTransaction } from "../src/db/transaction.js";
import { createBillingRepository } from "../src/modules/billing/repository.js";
import { createIdempotencyRepository } from "../src/modules/billing/idempotencyRepository.js";
import { createPaymentRepository } from "../src/modules/billing/paymentRepository.js";
import { createBillingService } from "../src/modules/billing/service.js";
import { createBillingWebhookWorker } from "../src/modules/billing/worker.js";
import { createActivityRepository } from "../src/modules/activity/repository.js";
import { createActivityService } from "../src/modules/activity/service.js";
import {
  ledgerEntries,
  payments,
  subscriptions,
  webhookEvents,
} from "../src/db/schema/shard.js";
import { idempotencyKeys, users, userTeams } from "../src/db/schema/global.js";
import type { PaymentProvider, VerifiedTransaction } from "../src/providers/payments/types.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../../.env"), quiet: true });

type Mode = "quick" | "full";

interface SafeDatabaseError {
  code: string | null;
  constraint: string | null;
  table: string | null;
}

function readMode(): Mode {
  const args = process.argv.slice(2);
  if (args.includes("--full") && !args.includes("--quick")) return "full";
  if (args.includes("--quick") && !args.includes("--full")) return "quick";
  throw new Error("Choose exactly one mode: --quick or --full");
}

function log(name: string, value: unknown): void {
  process.stdout.write(`${name}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeDatabaseError(error: unknown): SafeDatabaseError {
  const outer = asRecord(error);
  const wrapped = outer !== undefined && "cause" in outer ? outer.cause : error;
  const source = asRecord(wrapped) ?? outer ?? {};
  return {
    code: typeof source.code === "string" ? source.code : null,
    constraint: typeof source.constraint === "string" ? source.constraint : null,
    table: typeof source.table === "string" ? source.table : null,
  };
}

function logDatabaseError(label: string, error: unknown): void {
  const safe = safeDatabaseError(error);
  log(`${label}_code`, safe.code);
  log(`${label}_constraint`, safe.constraint);
  log(`${label}_table`, safe.table);
}

const mode = readMode();
const burst = mode === "full" ? 50 : 5;
const rounds = mode === "full" ? 5 : 2;
const runTag = randomBytes(6).toString("hex");
const webhookHash = `proof-${runTag}`;

function proofId(label: string): string {
  const digest = createHash("sha256").update(`${runTag}:${label}`).digest("hex");
  return `${runTag.slice(0, 8)}-${digest.slice(0, 4)}-4${digest.slice(5, 8)}-8${digest.slice(9, 12)}-${digest.slice(12, 24)}`;
}

function proofEmail(label: string): string {
  const clean = label.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${runTag}.${clean}@proof.invalid`;
}

function eventKeyFor(providerTxId: string): string {
  return `charge.completed:${providerTxId}:successful:${runTag}`;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const redisUrl = process.env.REDIS_URL?.trim();
if (!databaseUrl || !redisUrl) throw new Error("missing env");

const pool = new Pool({
  connectionString: databaseUrl,
  max: mode === "full" ? 8 : 4,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 60_000,
});
pool.on("error", () => {});
const db = createDb(pool);
configureShards([db]);
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 2,
  lazyConnect: true,
  enableReadyCheck: false,
});
redis.on("error", () => {});

const redisLock = {
  set: (key: string, value: string, modeFlag: "EX", seconds: number, nx: "NX") =>
    redis.set(key, value, modeFlag, seconds, nx),
  eval: (script: string, keys: readonly string[], args: readonly (string | number)[]) =>
    redis.eval(script, keys.length, ...keys, ...args),
};

async function main(): Promise<void> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const repo = createBillingRepository(db);
  const paymentRepo = createPaymentRepository();
  const idemRepo = createIdempotencyRepository();
  const activity = createActivityService(createActivityRepository());

  const verifiedById = new Map<string, VerifiedTransaction>();
  const failuresLeft = new Map<string, number>();

  const provider: PaymentProvider = {
    verifyWebhookAuth(headers) {
      const raw = headers["verif-hash"];
      const received = Array.isArray(raw) ? raw[0] : raw;
      return received === webhookHash;
    },
    async createCheckout() {
      return { checkoutUrl: `https://checkout.test/${runTag}` };
    },
    async verifyTransaction(providerTxId) {
      const failures = failuresLeft.get(providerTxId) ?? 0;
      if (failures > 0) {
        failuresLeft.set(providerTxId, failures - 1);
        throw new Error("provider temporary");
      }
      const verified = verifiedById.get(providerTxId);
      if (verified === undefined) throw new Error("provider unknown transaction");
      return verified;
    },
    async verifyByReference(txRef) {
      for (const verified of verifiedById.values()) {
        if (verified.txRef === txRef) return verified;
      }
      throw new Error("provider unknown transaction");
    },
  };

  const service = createBillingService({
    repository: repo,
    paymentRepository: paymentRepo,
    idempotencyRepository: idemRepo,
    globalDb: db,
    provider,
    paymentsEnabled: true,
    currency: "USD",
    publicApiUrl: "https://example.test",
    transactions: runShardTransaction,
    now: () => now,
    redis: redisLock,
    activity,
  });

  async function createProofTeam(label: string): Promise<{ teamId: string; ownerId: string; email: string; teamName: string }> {
    const teamId = proofId(`team:${label}`);
    const ownerId = proofId(`user:${label}`);
    const email = proofEmail(label);
    const teamName = `proof-${runTag}-${label}`;
    const shard = getShardFor(teamId);

    await db.insert(users).values({ id: ownerId, email, passwordHash: "x" });
    await db.insert(userTeams).values({ userId: ownerId, teamId });
    await shard.execute(sql`insert into teams (id, name, owner_id) values (${teamId}::uuid, ${teamName}, ${ownerId}::uuid)`);
    await shard.execute(sql`insert into memberships (team_id, user_id, role) values (${teamId}::uuid, ${ownerId}::uuid, 'owner')`);

    return { teamId, ownerId, email, teamName };
  }

  const mainTeam = await createProofTeam("main");

  const idempotencyKey = `idem-${runTag}-race`;
  const raceResults = await Promise.all(
    Array.from({ length: 20 }, () =>
      service
        .checkout(mainTeam.teamId, mainTeam.ownerId, mainTeam.email, idempotencyKey, {
          planId: "starter",
          seats: 5,
        })
        .then(() => 200)
        .catch((error: unknown) => {
          const record = asRecord(error);
          return typeof record?.status === "number" ? record.status : 500;
        }),
    ),
  );
  log("checkout_race_200", raceResults.filter((status) => status === 200).length);

  const mainShard = getShardFor(mainTeam.teamId);
  const paymentRows = await mainShard
    .select()
    .from(payments)
    .where(eq(payments.teamId, mainTeam.teamId));
  log("checkout_race_payment_rows", paymentRows.length);

  function registerVerified(providerTxId: string, txRef: string, amountCents: number, currency = "USD"): void {
    verifiedById.set(providerTxId, {
      providerTxId,
      txRef,
      status: "successful",
      amountCents,
      currency,
    });
  }

  async function insertWebhookEvent(
    teamId: string,
    eventKey: string,
    txRef: string,
    providerTxId: string,
    amountMajor: string,
    currency = "USD",
  ): Promise<void> {
    const shard = getShardFor(teamId);
    await shard.insert(webhookEvents).values({
      eventKey,
      teamId,
      provider: "flutterwave",
      txRef,
      payload: {
        event: "charge.completed",
        data: {
          id: providerTxId,
          tx_ref: txRef,
          status: "successful",
          amount: amountMajor,
          currency,
        },
      },
    });
  }

  async function insertChangePayment(
    teamId: string,
    ownerId: string,
    label: string,
    amountCents: number,
    planId: "team" | "business",
    seats: number,
    quote: { chargeCents: number; creditCents: number; costCents: number },
  ): Promise<{ txRef: string; providerTxId: string; eventKey: string }> {
    const paymentId = proofId(`payment:${label}`);
    const txRef = `rota.${teamId}.${paymentId}`;
    const providerTxId = proofId(`provider:${label}`);
    const eventKey = eventKeyFor(providerTxId);
    const shard = getShardFor(teamId);

    await shard.insert(payments).values({
      id: paymentId,
      teamId,
      txRef,
      kind: "change",
      amountCents,
      currency: "USD",
      planId,
      seats,
      quote,
      status: "pending",
      createdBy: ownerId,
      updatedAt: now,
    });
    registerVerified(providerTxId, txRef, amountCents);

    return { txRef, providerTxId, eventKey };
  }

  const worker = createBillingWebhookWorker({
    provider,
    repository: repo,
    paymentRepository: paymentRepo,
    transactions: runShardTransaction,
    activity,
    now: () => now,
  });

  const initialPayment = paymentRows[0];
  if (initialPayment === undefined) throw new Error("missing checkout payment");

  const initialProviderTxId = proofId(`provider:initial:${runTag}`);
  registerVerified(initialProviderTxId, initialPayment.txRef, initialPayment.amountCents);
  const initialEventKey = eventKeyFor(initialProviderTxId);
  await insertWebhookEvent(
    mainTeam.teamId,
    initialEventKey,
    initialPayment.txRef,
    initialProviderTxId,
    "20.00",
  );

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await worker({ data: { eventKey: initialEventKey, teamId: mainTeam.teamId, txRef: initialPayment.txRef } } as never);
  }

  const ledgerAfter3 = await mainShard
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.teamId, mainTeam.teamId));
  const subAfter3 = await mainShard
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.teamId, mainTeam.teamId));
  log("webhook_x3_ledger_rows", ledgerAfter3.length);
  log("webhook_x3_status", subAfter3[0]?.status ?? "none");

  for (let round = 0; round < rounds; round += 1) {
    const jobs = Array.from({ length: burst }, () =>
      worker({ data: { eventKey: initialEventKey, teamId: mainTeam.teamId, txRef: initialPayment.txRef } } as never),
    );
    await Promise.all(jobs);
  }
  const ledgerAfterRace = await mainShard
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.teamId, mainTeam.teamId));
  log("webhook_race_ledger_rows", ledgerAfterRace.length);
  log("webhook_race_mode", `${mode}:${burst}x${rounds}`);

  log("bad_hash_stored", provider.verifyWebhookAuth({ "verif-hash": `bad-${runTag}` }) ? 1 : 0);

  const mismatchTeam = await createProofTeam("amountcheck");
  const mismatchShard = getShardFor(mismatchTeam.teamId);
  const mismatchPayment = await insertChangePayment(
    mismatchTeam.teamId,
    mismatchTeam.ownerId,
    "amountcheck",
    500,
    "team",
    15,
    { chargeCents: 500, creditCents: 0, costCents: 500 },
  );
  const mismatchProviderTxId = proofId(`provider:amountcheck:wrong:${runTag}`);
  registerVerified(mismatchProviderTxId, mismatchPayment.txRef, 999);
  const mismatchEventKey = eventKeyFor(mismatchProviderTxId);
  await insertWebhookEvent(
    mismatchTeam.teamId,
    mismatchEventKey,
    mismatchPayment.txRef,
    mismatchProviderTxId,
    "9.99",
  );
  await worker({
    data: { eventKey: mismatchEventKey, teamId: mismatchTeam.teamId, txRef: mismatchPayment.txRef },
  } as never);
  const mismatchPaymentRows = await mismatchShard
    .select()
    .from(payments)
    .where(eq(payments.txRef, mismatchPayment.txRef));
  const mismatchLedgerRows = await mismatchShard
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.teamId, mismatchTeam.teamId));
  log("amount_mismatch_status", mismatchPaymentRows[0]?.status ?? "none");
  log("amount_mismatch_ledger_rows", mismatchLedgerRows.length);

  const retryPayment = await insertChangePayment(
    mainTeam.teamId,
    mainTeam.ownerId,
    "retry",
    360,
    "team",
    18,
    { chargeCents: 360, creditCents: 2640, costCents: 3000 },
  );
  failuresLeft.set(retryPayment.providerTxId, 2);
  await insertWebhookEvent(
    mainTeam.teamId,
    retryPayment.eventKey,
    retryPayment.txRef,
    retryPayment.providerTxId,
    "3.60",
  );
  let retryErrors = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await worker({
        data: { eventKey: retryPayment.eventKey, teamId: mainTeam.teamId, txRef: retryPayment.txRef },
      } as never);
    } catch {
      retryErrors += 1;
    }
  }
  await worker({
    data: { eventKey: retryPayment.eventKey, teamId: mainTeam.teamId, txRef: retryPayment.txRef },
  } as never);
  const retryPaymentRows = await mainShard
    .select()
    .from(payments)
    .where(eq(payments.txRef, retryPayment.txRef));
  log("retry_errors", retryErrors);
  log("retry_final_status", retryPaymentRows[0]?.status ?? "none");

  const restartPayment = await insertChangePayment(
    mainTeam.teamId,
    mainTeam.ownerId,
    "restart",
    100,
    "team",
    16,
    { chargeCents: 100, creditCents: 2400, costCents: 2500 },
  );
  await insertWebhookEvent(
    mainTeam.teamId,
    restartPayment.eventKey,
    restartPayment.txRef,
    restartPayment.providerTxId,
    "1.00",
  );
  const unprocessed = await mainShard
    .select()
    .from(webhookEvents)
    .where(and(eq(webhookEvents.teamId, mainTeam.teamId), sql`${webhookEvents.processedAt} is null`));
  log("restart_unprocessed_count", unprocessed.length);

  const ledger = await mainShard
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.teamId, mainTeam.teamId))
    .orderBy(ledgerEntries.createdAt, ledgerEntries.id);
  let rebuildPlanId = "starter";
  let rebuildSeats = 5;
  let rebuildStatus = "none";
  for (const row of ledger) {
    if (row.planId) rebuildPlanId = row.planId;
    if (row.seats) rebuildSeats = row.seats;
    if (["charge", "credit", "plan_change", "seat_change", "renewal", "adjustment"].includes(row.type)) {
      rebuildStatus = "active";
    }
  }
  const sub = await mainShard
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.teamId, mainTeam.teamId));
  log(
    "rebuild_match",
    sub[0]?.planId === rebuildPlanId && sub[0]?.seats === rebuildSeats && sub[0]?.status === rebuildStatus ? 1 : 0,
  );

  const trigger = await mainShard.execute(sql`
    select tgenabled = 'O' as enabled
    from pg_trigger
    where tgrelid = 'ledger_entries'::regclass
      and tgname = 'ledger_entries_append_only'
      and not tgisinternal
  `);
  log("trigger_ledger_entries_append_only_enabled", trigger.rows[0]?.enabled === true);

  await mainShard.execute(sql`
    delete from webhook_events where team_id in (
      select id from teams where name like 'proof-%' or name = 'Proof'
    )
  `);
  await mainShard.execute(sql`
    delete from payments where team_id in (
      select id from teams where name like 'proof-%' or name = 'Proof'
    )
  `);
  await mainShard.execute(sql`
    delete from activity_events where team_id in (
      select id from teams where name like 'proof-%' or name = 'Proof'
    )
  `);
  await db.execute(sql`
    delete from idempotency_keys where user_id in (
      select id from users
      where email like '%@proof.invalid' or email like 'billing-proof-%@example.test'
    )
  `);
  await db.execute(sql`
    delete from invites where invited_by in (
      select id from users
      where email like '%@proof.invalid' or email like 'billing-proof-%@example.test'
    )
  `);
  await db.execute(sql`
    delete from user_teams
    where team_id in (select id from teams where name like 'proof-%' or name = 'Proof')
       or user_id in (
         select id from users
         where email like '%@proof.invalid' or email like 'billing-proof-%@example.test'
       )
  `);
  await mainShard.execute(sql`
    delete from memberships where team_id in (
      select t.id from teams t
      where (t.name like 'proof-%' or t.name = 'Proof')
        and not exists (select 1 from ledger_entries l where l.team_id = t.id)
    )
  `);
  await db.execute(sql`
    delete from users
    where (email like '%@proof.invalid' or email like 'billing-proof-%@example.test')
      and not exists (select 1 from user_teams ut where ut.user_id = users.id)
      and not exists (select 1 from invites i where i.invited_by = users.id)
      and not exists (select 1 from refresh_tokens rt where rt.user_id = users.id)
  `);
  await mainShard.execute(sql`
    delete from teams t
    where (t.name like 'proof-%' or t.name = 'Proof')
      and not exists (select 1 from ledger_entries l where l.team_id = t.id)
      and not exists (select 1 from subscriptions s where s.team_id = t.id)
      and not exists (select 1 from memberships m where m.team_id = t.id)
      and not exists (select 1 from shifts s where s.team_id = t.id)
      and not exists (select 1 from swap_requests sr where sr.team_id = t.id)
  `);

  const remaining = await mainShard.execute(sql`
    select
      (select count(*) from teams t
        where (t.name like 'proof-%' or t.name = 'Proof')
          and exists (select 1 from ledger_entries l where l.team_id = t.id))::text as teams_with_ledger_left,
      (select count(*) from teams t
        where t.name like 'proof-%' or t.name = 'Proof')::text as teams_left_total
  `);
  log("teams_with_ledger_left", remaining.rows[0]?.teams_with_ledger_left ?? "0");
  log("teams_left_total", remaining.rows[0]?.teams_left_total ?? "0");

  const triggerAfter = await mainShard.execute(sql`
    select tgenabled = 'O' as enabled
    from pg_trigger
    where tgrelid = 'ledger_entries'::regclass
      and tgname = 'ledger_entries_append_only'
      and not tgisinternal
  `);
  log("trigger_after_cleanup_enabled", triggerAfter.rows[0]?.enabled === true);
  log("cleanup", "ok");
}

main()
  .catch((error: unknown) => {
    logDatabaseError("database_error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit().catch(() => redis.disconnect());
    await pool.end().catch(() => undefined);
  });
