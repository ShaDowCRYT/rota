import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(currentDir, "../../.env"),
  quiet: true,
});

const directUrl = process.env.DATABASE_URL_DIRECT?.trim();

if (!directUrl) {
  process.stderr.write("DATABASE_URL_DIRECT is required to run migrations.\n");
  process.exit(1);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: directUrl });

  try {
    const database = drizzle(pool);

    await migrate(database, {
      migrationsFolder: path.resolve(currentDir, "../drizzle/global"),
      migrationsTable: "drizzle_migrations_global",
    });

    await migrate(database, {
      migrationsFolder: path.resolve(currentDir, "../drizzle/shard"),
      migrationsTable: "drizzle_migrations_shard",
    });

    process.stdout.write("Migrations completed.\n");
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write("Database migration failed.\n");
  process.exitCode = 1;
});
