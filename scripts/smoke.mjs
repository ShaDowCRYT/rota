import process from "node:process";

const base = process.argv[2];
if (!base) {
  console.error("Usage: node scripts/smoke.mjs <base-url>");
  process.exit(1);
}

const baseUrl = new URL(base);
const checks = [];

async function timed(name, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    checks.push({ name, ok: result.ok, ms: Date.now() - start, detail: result.detail });
  } catch (error) {
    checks.push({ name, ok: false, ms: Date.now() - start, detail: String(error) });
  }
}

await timed("GET /health", async () => {
  const res = await fetch(new URL("/health", baseUrl));
  const body = await res.json();
  const ok = res.status === 200 && body?.status === "ok";
  return { ok, detail: `status=${res.status} body=${JSON.stringify(body)}` };
});

await timed("GET /health/ready", async () => {
  const res = await fetch(new URL("/health/ready", baseUrl));
  const body = await res.json();
  const ok = res.status === 200 && body?.database === "ok" && body?.redis === "ok";
  return { ok, detail: `status=${res.status} database=${body?.database} redis=${body?.redis}` };
});

await timed("no x-powered-by on /health", async () => {
  const res = await fetch(new URL("/health", baseUrl));
  const ok = !res.headers.has("x-powered-by");
  return { ok, detail: ok ? "absent" : `present=${res.headers.get("x-powered-by")}` };
});

await timed("unknown route 404 no stack trace", async () => {
  const res = await fetch(new URL("/__smoke_unknown__", baseUrl));
  const text = await res.text();
  const hasStack = text.includes(" at ") || text.includes("Error:");
  const ok = res.status === 404 && !hasStack;
  return { ok, detail: `status=${res.status} stack=${hasStack}` };
});

let failed = false;
for (const check of checks) {
  const status = check.ok ? "PASS" : "FAIL";
  if (!check.ok) failed = true;
  console.log(`${status} ${check.name} (${check.ms}ms) - ${check.detail}`);
}

process.exit(failed ? 1 : 0);
