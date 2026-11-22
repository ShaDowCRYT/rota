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

function hasUrlScheme(value: string, schemes: readonly string[]): boolean {
  if (!schemes.some((scheme) => value.startsWith(scheme))) {
    return false;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isPostgresUrl(value: string): boolean {
  return hasUrlScheme(value, ["postgres://", "postgresql://"]);
}

function isRedisUrl(value: string): boolean {
  return hasUrlScheme(value, ["redis://", "rediss://"]);
}

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(["development", "test", "production"]).default("development"),
  ),
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
  DATABASE_URL_DIRECT: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .refine(
        isPostgresUrl,
        "DATABASE_URL_DIRECT must be a valid postgres:// or postgresql:// URL",
      )
      .optional(),
  ),
  REDIS_URL: z.preprocess(
    (value) => (value === undefined ? "" : value),
    z
      .string()
      .trim()
      .min(1, "REDIS_URL is required")
      .refine(
        isRedisUrl,
        "REDIS_URL must be a valid redis:// or rediss:// URL",
      ),
  ),
  DB_POOL_MAX: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(20).default(10),
  ),
  JWT_ACCESS_SECRET: z.preprocess(
    (value) => (value === undefined ? "" : value),
    z
      .string()
      .trim()
      .min(1, "JWT_ACCESS_SECRET is required")
      .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ),
  ACCESS_TOKEN_TTL_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(900),
  ),
  REFRESH_TOKEN_TTL_DAYS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(90).default(30),
  ),
  INVITE_TTL_DAYS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(30).default(7),
  ),
  RESET_TOKEN_TTL_MINUTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(1440).default(30),
  ),
  SENTRY_DSN: z.preprocess(
    emptyToUndefined,
    z.url("SENTRY_DSN must be a valid URL").optional(),
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
