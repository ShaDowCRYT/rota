import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { getErrorMessage } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { parseEnvironment, type Environment } from "./envSchema.js";

// The .env file lives at the repo root. Both src/config and dist/config sit
// two levels below it, so this path works for dev and built output.
const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.resolve(currentDir, "../../../.env"),
  quiet: true,
});

let parsed: Environment;

try {
  parsed = parseEnvironment(process.env);
} catch (error) {
  process.stderr.write(`${getErrorMessage(error)}\n`);
  process.exit(1);
}

export const env = parsed;

logger.info(
  env.GOOGLE_WEB_CLIENT_ID
    ? "google sign-in: enabled"
    : "google sign-in: disabled",
);
