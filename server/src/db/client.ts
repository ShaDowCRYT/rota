import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export function createDb(pool: Pool) {
  return drizzle(pool);
}

export type Database = ReturnType<typeof createDb>;
