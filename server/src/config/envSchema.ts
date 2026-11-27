import { z } from "zod";

export const GOOGLE_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";
export const GOOGLE_CLIENT_ID_ERROR = `GOOGLE_WEB_CLIENT_ID must end with ${GOOGLE_CLIENT_ID_SUFFIX}`;

const emptyToUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value;

const googleClientIdToUndefined = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return emptyToUndefined(value);
  }
  return emptyToUndefined(value.trim());
};

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

export const envSchema = z.object({
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
  TRUST_PROXY_HOPS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(3).default(0),
  ),
  FLUTTERWAVE_SECRET_KEY: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).optional(),
  ),
  FLUTTERWAVE_SECRET_HASH: z.preprocess(
    emptyToUndefined,
    z.string().trim().min(1).optional(),
  ),
  BILLING_CURRENCY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "BILLING_CURRENCY must be 3 uppercase letters")
      .default("USD"),
  ),
  PUBLIC_API_URL: z.preprocess(
    emptyToUndefined,
    z.url("PUBLIC_API_URL must be a valid URL").optional(),
  ),
  RUN_WORKER: z.preprocess(
    emptyToUndefined,
    z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default(true),
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
  GOOGLE_WEB_CLIENT_ID: z.preprocess(
    googleClientIdToUndefined,
    z
      .string()
      .refine((value) => value.endsWith(GOOGLE_CLIENT_ID_SUFFIX), {
        message: GOOGLE_CLIENT_ID_ERROR,
      })
      .optional(),
  ),
});

export type Environment = z.infer<typeof envSchema>;

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function paymentsConfigured(env: Environment): boolean {
  return (
    env.FLUTTERWAVE_SECRET_KEY !== undefined &&
    env.FLUTTERWAVE_SECRET_HASH !== undefined &&
    env.PUBLIC_API_URL !== undefined
  );
}

export function parseEnvironment(values: NodeJS.ProcessEnv): Environment {
  const parsed = envSchema.safeParse(values);

  if (!parsed.success) {
    throw new EnvironmentError(
      `Invalid environment configuration:\n${z.prettifyError(parsed.error)}`,
    );
  }

  const env = parsed.data;
  if (env.NODE_ENV === "production" && env.PUBLIC_API_URL !== undefined) {
    if (!isHttpsUrl(env.PUBLIC_API_URL)) {
      throw new EnvironmentError(
        "Invalid environment configuration:\nPUBLIC_API_URL must use https in production",
      );
    }
  }

  return env;
}
