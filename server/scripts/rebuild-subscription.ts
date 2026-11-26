import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { ledgerEntries, subscriptions } from "../src/db/schema/shard.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "../../.env"), quiet: true });

const teamId = process.argv[2]?.trim();
const directUrl = process.env.DATABASE_URL_DIRECT?.trim();
if (!teamId || !directUrl) {
  process.stderr.write("Usage: tsx scripts/rebuild-subscription.ts <teamId>\n");
  process.exit(1);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: directUrl });
  const db = drizzle(pool);
  try {
    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.teamId, teamId))
      .orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));

    let state: { planId: string; seats: number; status: "none" | "active" | "past_due" | "restricted"; periodStart: Date | null; periodEnd: Date | null } = {
      planId: "starter",
      seats: 5,
      status: "none",
      periodStart: null,
      periodEnd: null,
    };

    for (const row of rows) {
      if (row.planId) state.planId = row.planId;
      if (row.seats) state.seats = row.seats;
      if (row.periodStart) state.periodStart = row.periodStart;
      if (row.periodEnd) state.periodEnd = row.periodEnd;
      if (["plan_change", "seat_change", "charge", "renewal", "adjustment"].includes(row.type)) {
        state.status = "active";
      }
    }

    if (state.periodStart && state.periodEnd) {
      await db
        .insert(subscriptions)
        .values({
          teamId,
          planId: state.planId,
          seats: state.seats,
          periodStart: state.periodStart,
          periodEnd: state.periodEnd,
          status: state.status,
          pendingPlanId: null,
          pendingSeats: null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: subscriptions.teamId,
          set: {
            planId: state.planId,
            seats: state.seats,
            periodStart: state.periodStart,
            periodEnd: state.periodEnd,
            status: state.status,
            pendingPlanId: null,
            pendingSeats: null,
            updatedAt: new Date(),
          },
        });
    }

    process.stdout.write(`${JSON.stringify({ teamId, ...state })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
