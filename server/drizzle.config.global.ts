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
  schema: "./src/db/schema/global.ts",
  out: "./drizzle/global",
  migrations: {
    table: "drizzle_migrations_global",
  },
  dbCredentials: {
    url: process.env.DATABASE_URL_DIRECT ?? "",
  },
});
