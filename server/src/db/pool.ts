import { Pool } from "pg";

import { env } from "../config/env.js";
import { getErrorMessage } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool !== undefined) {
    return pool;
  }

  const created = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  created.on("error", (error) => {
    logger.error("idle database client error", {
      error: getErrorMessage(error),
    });
  });

  pool = created;
  return created;
}

export async function closePool(): Promise<void> {
  if (pool === undefined) {
    return;
  }

  const current = pool;
  pool = undefined;
  await current.end();
}

export async function checkDatabase(): Promise<void> {
  await getPool().query("SELECT 1");
}
