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

const envSchema = z.object({
  PORT: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).max(65535).default(3000),
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
