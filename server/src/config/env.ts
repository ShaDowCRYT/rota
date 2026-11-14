import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { z } from "zod";

// The .env file lives at the repo root. Both src/config and dist/config sit
// two levels below it, so this path works for dev and built output.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(currentDir, "../../../.env"),
  quiet: true,
});

const emptyToUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value;

function isPostgresUrl(value: string): boolean {
  const hasPostgresScheme =
    value.startsWith("postgres://") || value.startsWith("postgresql://");
  if (!hasPostgresScheme) {
    return false;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(65535).default(3000),
  ),
  DATABASE_URL: z.preprocess(
    (value) => (value === undefined ? "" : value),
    z
      .string()
      .trim()
      .min(1, "DATABASE_URL is required")
      .refine(
        isPostgresUrl,
        "DATABASE_URL must be a valid postgres:// or postgresql:// URL",
      ),
  ),
  DB_POOL_MAX: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(20).default(10),
  ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  process.stderr.write(
    `Invalid environment configuration:\n${z.prettifyError(parsed.error)}\n`,
  );
  process.exit(1);
}

export const env = parsed.data;
