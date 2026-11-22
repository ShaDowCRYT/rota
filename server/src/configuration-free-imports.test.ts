import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const settings = [
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "SENTRY_DSN",
  "GOOGLE_WEB_CLIENT_ID",
] as const;

const saved = new Map<string, string | undefined>();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(fullPath);
    }
    return entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
      ? [fullPath]
      : [];
  });
}

const srcRoot = dirname(fileURLToPath(import.meta.url));
const modules = [
  ...sourceFiles(join(srcRoot, "modules")),
  ...sourceFiles(join(srcRoot, "lib")),
];

describe("configuration-free imports", () => {
  beforeAll(() => {
    for (const name of settings) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterAll(() => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("modules can be imported without configuration", async () => {
    expect(modules.length).toBeGreaterThan(0);

    for (const file of modules) {
      const imported = await import(pathToFileURL(file).href);
      expect(imported).toBeDefined();
    }
  }, 30_000);
});
