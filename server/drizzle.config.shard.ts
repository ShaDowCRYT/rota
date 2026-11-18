import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(currentDir, "../.env"),
  quiet: true,
});

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/shard.ts",
  out: "./drizzle/shard",
  migrations: {
    table: "drizzle_migrations_shard",
  },
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? "",
  },
});
