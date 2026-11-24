import type { SQLWrapper } from "drizzle-orm";

export interface SqlExecutor {
  execute(query: SQLWrapper): Promise<{ rows: Record<string, unknown>[] }>;
}

export type TransactionRunner = <T>(
  teamId: string,
  work: (executor: SqlExecutor) => Promise<T>,
) => Promise<T>;
