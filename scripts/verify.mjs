import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "server");
const appDir = path.join(root, "app");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

const settingsKeys = [
  "DATABASE_URL",
  "DATABASE_URL_DIRECT",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "SENTRY_DSN",
];

const sensitiveKeyPattern =
  /(SECRET|TOKEN|PASSWORD|PASS|DSN|CREDENTIAL|API_?KEY|PRIVATE_?KEY|DATABASE_URL|REDIS_URL)/i;

let checksRun = 0;
let stoppedAt = "";

function log(message = "") {
  process.stdout.write(`${message}\n`);
}

function redact(text) {
  let output = String(text ?? "");
  const keys = new Set([
    ...settingsKeys,
    ...Object.keys(process.env).filter((key) => sensitiveKeyPattern.test(key)),
  ]);

  for (const key of keys) {
    const value = process.env[key];
    if (value) {
      output = output.split(value).join("[REDACTED]");
    }
  }

  return output;
}

function writeOutput(stream, text) {
  const cleaned = redact(text).replace(/\r?\n$/, "");
  if (cleaned.length > 0) {
    stream.write(`${cleaned}\n`);
  }
}

function mark(label, ok) {
  checksRun += 1;
  if (!ok) {
    stoppedAt = label;
  }
  log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  return ok;
}

function executeCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.stdout) {
    writeOutput(process.stdout, result.stdout);
  }
  if (result.stderr) {
    writeOutput(process.stderr, result.stderr);
  }
  if (result.error) {
    process.stderr.write(`${redact(result.error.message)}\n`);
  }

  return !result.error && result.status === 0;
}

function runStep(label, command, args, options = {}) {
  log(`\n${label}`);
  log(`  $ ${command} ${args.join(" ")}`);
  return mark(label, executeCommand(command, args, options));
}

function listTrackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? "git ls-files failed");
  }

  return result.stdout.split("\0").filter(Boolean);
}

function checkTrackedEnvNames() {
  const label = "Secret scan: no tracked .env or *.env.local";
  log("\nSecret scan: tracked file names");

  let files;
  try {
    files = listTrackedFiles();
  } catch (error) {
    process.stderr.write(`${redact(error.message)}\n`);
    return mark(label, false);
  }

  const bad = files.filter((file) => {
    const name = path.posix.basename(file.replace(/\\/g, "/"));
    return name === ".env" || name.endsWith(".env.local");
  });

  for (const file of bad) {
    log(`  Found: ${file}`);
  }

  return mark(label, bad.length === 0);
}

function checkTrackedTextForSecrets() {
  const label = "Secret scan: no tracked text with a credential string";
  log("\nSecret scan: tracked text files");
  const urlWithPassword = new RegExp(
    "(?:postgres(?:ql)?|rediss?|mysql|mongodb(?:\\+srv)?)\\:\\/\\/[^:\\/@\\s]+:[^@\\/\\s]+@",
    "i",
  );
  const flutterwaveKey = new RegExp("FLW" + "SECK[A-Za-z0-9_-]{4,}", "i");

  let files;
  try {
    files = listTrackedFiles();
  } catch (error) {
    process.stderr.write(`${redact(error.message)}\n`);
    return mark(label, false);
  }

  const hits = [];
  const unreadable = [];

  for (const file of files) {
    const absolute = path.join(root, file);
    let content;

    try {
      if (!fs.statSync(absolute).isFile()) {
        continue;
      }
      content = fs.readFileSync(absolute, "utf8");
    } catch {
      const deleted = spawnSync("git", ["ls-files", "--deleted", "--", file], {
        cwd: root,
        encoding: "utf8",
      });
      if (deleted.status === 0 && deleted.stdout.trim() === file) {
        continue;
      }
      unreadable.push(file);
      continue;
    }

    if (content.includes("\0")) {
      continue;
    }

    content.split(/\r?\n/).forEach((line, index) => {
      if (urlWithPassword.test(line) || flutterwaveKey.test(line)) {
        hits.push(`${file}:${index + 1}`);
      }
    });
  }

  for (const file of unreadable) {
    log(`  Unreadable: ${file}`);
  }
  for (const hit of hits) {
    log(`  Found: ${hit}`);
  }

  return mark(label, hits.length === 0 && unreadable.length === 0);
}

function checkEnvIgnored() {
  const label = "Secret scan: .env files are ignored by git";
  log("\nSecret scan: git ignore rules");
  const candidates = [
    ".env",
    ".env.local",
    ".env.test",
    ".env.production",
    "server/.env",
    "app/.env",
  ];
  const notIgnored = [];

  for (const file of candidates) {
    const result = spawnSync(
      "git",
      ["check-ignore", "-q", "--no-index", "--", file],
      { cwd: root, encoding: "utf8" },
    );

    if (result.error || ![0, 1].includes(result.status)) {
      process.stderr.write(
        `${redact(result.error?.message ?? "git check-ignore failed")}\n`,
      );
      return mark(label, false);
    }

    if (result.status !== 0) {
      notIgnored.push(file);
    }
  }

  for (const file of notIgnored) {
    log(`  Not ignored: ${file}`);
  }

  return mark(label, notIgnored.length === 0);
}

function isEnvFile(name) {
  return (
    name === ".env" ||
    (name.startsWith(".env.") && name !== ".env.example") ||
    name.endsWith(".env.local")
  );
}

function hideEnvFiles() {
  const hidden = [];
  const suffix = `.verify-hidden-${process.pid}`;

  for (const directory of [root, serverDir, appDir]) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    const names = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter(isEnvFile);

    for (const name of names) {
      const original = path.join(directory, name);
      const backup = path.join(directory, `${name}${suffix}`);
      if (fs.existsSync(backup)) {
        throw new Error("A temporary hidden file name is already in use.");
      }
      fs.renameSync(original, backup);
      hidden.push({ original, backup });
    }
  }

  return hidden;
}

function restoreEnvFiles(hidden) {
  for (let index = hidden.length - 1; index >= 0; index -= 1) {
    fs.renameSync(hidden[index].backup, hidden[index].original);
  }
}

function runIsolatedServerTests() {
  const label = "Test isolation: server tests with no settings or .env";
  log(`\n${label}`);
  const env = { ...process.env };
  for (const key of settingsKeys) {
    delete env[key];
  }
  delete env.DOTENV_CONFIG_PATH;

  let hidden = [];
  let ok = false;

  try {
    hidden = hideEnvFiles();
    log(`  Hid ${hidden.length} local env file(s) for this check.`);
    log(`  $ ${npmCommand} test`);
    ok = executeCommand(npmCommand, ["test"], { cwd: serverDir, env });
  } catch (error) {
    process.stderr.write(`${redact(error.message)}\n`);
    ok = false;
  } finally {
    try {
      restoreEnvFiles(hidden);
    } catch (error) {
      process.stderr.write(`${redact(error.message)}\n`);
      ok = false;
    }
  }

  return mark(label, ok);
}

function finish(passed = false) {
  log("\n=== Summary ===");
  log(`Checks run: ${checksRun}`);
  log(`Result: ${passed ? "PASS" : "FAIL"}`);
  if (!passed) {
    log(`Stopped at: ${stoppedAt}`);
    process.exitCode = 1;
  }
}

function main() {
  log("Rota verification");

  if (
    !runStep("server: npm run build", npmCommand, ["run", "build"], {
      cwd: serverDir,
    })
  ) {
    return finish();
  }
  if (
    !runStep("server: npx tsc --noEmit", npxCommand, ["tsc", "--noEmit"], {
      cwd: serverDir,
    })
  ) {
    return finish();
  }
  if (
    !runStep("server: npm run lint", npmCommand, ["run", "lint"], {
      cwd: serverDir,
    })
  ) {
    return finish();
  }
  if (
    !runStep("server: npm test", npmCommand, ["test"], { cwd: serverDir })
  ) {
    return finish();
  }

  if (
    !runStep("app: npx tsc --noEmit", npxCommand, ["tsc", "--noEmit"], {
      cwd: appDir,
    })
  ) {
    return finish();
  }
  if (
    !runStep("app: npm run lint", npmCommand, ["run", "lint"], { cwd: appDir })
  ) {
    return finish();
  }
  if (!runStep("app: npm test", npmCommand, ["test"], { cwd: appDir })) {
    return finish();
  }

  if (!checkTrackedEnvNames()) {
    return finish();
  }
  if (!checkTrackedTextForSecrets()) {
    return finish();
  }
  if (!checkEnvIgnored()) {
    return finish();
  }
  if (!runIsolatedServerTests()) {
    return finish();
  }

  return finish(true);
}

main();
