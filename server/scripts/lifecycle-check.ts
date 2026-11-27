import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { Redis } from "ioredis";

import { createDb } from "../src/db/client.js";
import { configureShards, getShardFor } from "../src/db/shard.js";
import { runShardTransaction } from "../src/db/transaction.js";
import { createBillingRepository } from "../src/modules/billing/repository.js";
import { createPaymentRepository } from "../src/modules/billing/paymentRepository.js";
import { createActivityRepository } from "../src/modules/activity/repository.js";
import { createActivityService } from "../src/modules/activity/service.js";
import { runBillingMaintenance } from "../src/modules/billing/maintenance.js";
import { ledgerEntries, payments, subscriptions } from "../src/db/schema/shard.js";
import { userTeams, users } from "../src/db/schema/global.js";
import type { PaymentProvider, VerifiedTransaction } from "../src/providers/payments/types.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../../.env"), quiet: true });

type Mode = "quick" | "full";

function readMode(): Mode {
  const args = process.argv.slice(2);
  if (args.includes("--full") && !args.includes("--quick")) return "full";
  if (args.includes("--quick") && !args.includes("--full")) return "quick";
  throw new Error("Choose exactly one mode: --quick or --full");
}

function log(name: string, value: unknown): void {
  process.stdout.write(`${name}: ${typeof value === "string" ? value : JSON.stringify(value)}\n`);
}

function proofId(label: string): string {
  const digest = createHash("sha256").update(label).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

const mode = readMode();
const teamCount = mode === "full" ? 10 : 1;
const runTag = randomBytes(6).toString("hex");
const dueAt = new Date("2026-03-01T00:00:00.000Z");
const dayThree = new Date("2026-03-04T00:00:00.000Z");
const dayFive = new Date("2026-03-06T00:00:00.000Z");
const reconcileAt = new Date("2026-03-06T00:10:00.000Z");
const stalePaymentAt = new Date("2026-03-06T00:00:00.000Z");

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

async function main(): Promise<void> {
  await redis.connect();
  const redisOk = await redis.ping();
  log("redis_ok", redisOk === "PONG");

  const repository = createBillingRepository(db);
  const paymentRepository = createPaymentRepository();
  const activity = createActivityService(createActivityRepository());
  const verifiedByTxRef = new Map<string, VerifiedTransaction>();

  const provider: PaymentProvider = {
    verifyWebhookAuth() {
      return false;
    },
    async createCheckout() {
      throw new Error("unused");
    },
    async verifyTransaction() {
      throw new Error("unused");
    },
    async verifyByReference(txRef) {
      const verified = verifiedByTxRef.get(txRef);
      if (verified === undefined) throw new Error("provider unknown transaction");
      return verified;
    },
    parseWebhook() {
      return undefined;
    },
    describeIgnoredWebhook() {
      return { topLevelKeys: [], dataKeys: [] };
    },
  };

  const maintenance = (now: Date) => ({
    repository,
    paymentRepository,
    transactions: runShardTransaction,
    provider,
    email: { async send() {} },
    activity,
    currency: "USD",
    ensureRenewalCheckout: async () => ({
      checkoutUrl: `https://checkout.test/${runTag}`,
      paymentId: proofId(`unused:${now.toISOString()}`),
      amountCents: 2000,
      currency: "USD",
    }),
    now: () => now,
    limit: 100,
  });

  const dueResults: number[] = [];
  const reminderResults: number[] = [];
  const restrictionResults: number[] = [];
  const reconciliationResults: number[] = [];
  const statuses: string[] = [];
  const ledgerTypes: string[] = [];

  for (let index = 0; index < teamCount; index += 1) {
    const label = `${runTag}-${index}`;
    const teamId = proofId(`team:${label}`);
    const ownerId = proofId(`user:${label}`);
    const email = `${runTag}.${index}@proof.invalid`;
    const teamName = `proof-lifecycle-${label}`;
    const shard = getShardFor(teamId);

    await db.insert(users).values({ id: ownerId, email, passwordHash: "x" });
    await db.insert(userTeams).values({ userId: ownerId, teamId });
    await shard.execute(sql`insert into teams (id, name, owner_id) values (${teamId}::uuid, ${teamName}, ${ownerId}::uuid)`);
    await shard.execute(sql`insert into memberships (team_id, user_id, role) values (${teamId}::uuid, ${ownerId}::uuid, 'owner')`);
    await shard.insert(subscriptions).values({
      teamId,
      planId: "starter",
      seats: 5,
      periodStart: new Date(dueAt.getTime() - 30 * 24 * 60 * 60 * 1000),
      periodEnd: dueAt,
      status: "active",
      pendingPlanId: null,
      pendingSeats: null,
      graceEndsAt: null,
      lastNotice: 0,
    });

    const due = await runBillingMaintenance(maintenance(dueAt));
    dueResults.push(due.renewalPaymentsCreated);

    const reminder = await runBillingMaintenance(maintenance(dayThree));
    reminderResults.push(reminder.noticesSent);

    const restriction = await runBillingMaintenance(maintenance(dayFive));
    restrictionResults.push(restriction.restrictionsApplied);

    const renewalRows = await shard
      .select()
      .from(payments)
      .where(eq(payments.teamId, teamId));
    const renewal = renewalRows[0];
    if (renewal === undefined) throw new Error("missing renewal payment");
    verifiedByTxRef.set(renewal.txRef, {
      providerTxId: proofId(`provider:${label}`),
      txRef: renewal.txRef,
      status: "successful",
      amountCents: renewal.amountCents,
      currency: renewal.currency,
    });
    await shard
      .update(payments)
      .set({ updatedAt: stalePaymentAt })
      .where(eq(payments.id, renewal.id));

    const reconciled = await runBillingMaintenance(maintenance(reconcileAt));
    reconciliationResults.push(reconciled.paymentsReconciled);

    const subscriptionRows = await shard
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.teamId, teamId));
    statuses.push(subscriptionRows[0]?.status ?? "none");

    const ledgerRows = await shard
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.teamId, teamId));
    ledgerTypes.push(ledgerRows.map((row) => row.type).join(","));
  }

  log("mode", mode);
  log("teams_checked", teamCount);
  log("renewal_payments_created", dueResults.reduce((sum, value) => sum + value, 0));
  log("day3_notices_sent", reminderResults.reduce((sum, value) => sum + value, 0));
  log("restrictions_applied", restrictionResults.reduce((sum, value) => sum + value, 0));
  log("payments_reconciled", reconciliationResults.reduce((sum, value) => sum + value, 0));
  log("final_statuses", statuses);
  log("ledger_types", ledgerTypes);

  const shard = getShardFor(proofId(`team:${runTag}-0`));
  await shard.execute(sql`delete from activity_events where team_id in (select id from teams where name like 'proof-lifecycle-%')`);
  await shard.execute(sql`delete from payments where team_id in (select id from teams where name like 'proof-lifecycle-%')`);
  await shard.execute(sql`delete from webhook_events where team_id in (select id from teams where name like 'proof-lifecycle-%')`);
  await db.execute(sql`delete from user_teams where team_id in (select id from teams where name like 'proof-lifecycle-%')`);
  await shard.execute(sql`delete from memberships where team_id in (select id from teams where name like 'proof-lifecycle-%')`);
  await db.execute(sql`delete from users where email like '%.${runTag}.%@proof.invalid'`);
  await shard.execute(sql`delete from subscriptions where team_id in (select id from teams where name like 'proof-lifecycle-%')`);
  await shard.execute(sql`delete from teams where name like 'proof-lifecycle-%' and not exists (select 1 from ledger_entries l where l.team_id = teams.id)`);

  const remaining = await shard.execute(sql`
    select (select count(*) from ledger_entries l join teams t on t.id = l.team_id where t.name like 'proof-lifecycle-%')::text as ledger_rows_left
  `);
  log("ledger_rows_left", remaining.rows[0]?.ledger_rows_left ?? "0");
  log("cleanup", "ok");
}

main()
  .catch((error: unknown) => {
    log("error", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  })
  .finally(async () => {
    await redis.quit().catch(() => redis.disconnect());
    await pool.end().catch(() => undefined);
  });
