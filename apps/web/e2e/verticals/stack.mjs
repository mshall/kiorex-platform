// Isolated "verticals" stack for the Phase 3 journeys (pharmacy, lab, telemedicine).
//
// WHY ISOLATED: those flags are launch-locked (ADR-024). On the shared dev database they stay AWAITING_GATE until a human records gate
// evidence, and nothing in code may do that there. This script builds a THROWAWAY database (kiorex_e2e_verticals) and records clearly
// labelled TEST-FIXTURE gate rows in it only, exactly like the API's integration-test harness (apps/api/test/harness.ts). It also starts
// a second Kiorex API on :4001. Partners are the REAL Kiorly Pharmacy / Kiorly Lab dev services (partner registrations seeded with dev defaults by the API), so they must be running. The dev DB / dev API on :4000 are never touched.
//
//   node e2e/verticals/stack.mjs up | down
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, "../../../api");
const state = path.join(here, ".state");
const PSQL = process.env.PSQL ?? "/Users/postgres/bin/psql";
const DB = "kiorex_e2e_verticals";
const URL_DB = `postgresql://postgres:postgres@127.0.0.1:5433/${DB}?schema=public`;
const psql = (db, sql) => execFileSync(PSQL, ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-tAc", sql], { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" });
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: apiDir, env: { ...process.env, ...env }, stdio: "inherit" });
const waitFor = async (url, ms = 90_000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if ((await fetch(url)).ok) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 700)); } throw new Error(`timeout waiting for ${url}`); };

const cmd = process.argv[2];
mkdirSync(state, { recursive: true });

const stopAll = () => {
  for (const n of ["api"]) {
    const f = path.join(state, `${n}.pid`);
    if (existsSync(f)) { try { process.kill(-Number(readFileSync(f, "utf8")), "SIGTERM"); } catch { try { process.kill(Number(readFileSync(f, "utf8")), "SIGTERM"); } catch { /* gone */ } } }
  }
};
if (cmd === "up") {
  stopAll(); await new Promise((r) => setTimeout(r, 2000)); // a previous run may still hold :3120/:3130/:4001
  const exists = psql("postgres", `SELECT 1 FROM pg_database WHERE datname='${DB}'`).trim() === "1";
  if (!exists) psql("postgres", `CREATE DATABASE ${DB}`);
  run("npx", ["prisma", "migrate", "deploy"], { DATABASE_URL: URL_DB });
  run("npx", ["ts-node", "--transpile-only", "prisma/seed.ts"], { DATABASE_URL: URL_DB });
  for (const key of ["kiorex.pharmacy_orders", "kiorex.lab_bookings", "kiorex.telemedicine"]) {
    psql(DB, `INSERT INTO "FlagGateEvidence" ("flagKey","gateId","approver","approvedOn","documentUrl","recordedBy") VALUES ('${key}','E2E-FIXTURE-NOT-A-REAL-GATE','e2e fixture (not a human approval)',now(),'https://dev.invalid/e2e-fixture','E2E_FIXTURE') ON CONFLICT ("flagKey","gateId") DO NOTHING`);
  }
  console.log("[verticals] compiling API…");
  const out = path.join(here, ".api-dist");
  run("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", out, "--incremental", "false"]);
  writeFileSync(path.join(out, "package.json"), '{"type":"commonjs"}');
  const log = (n) => { const f = path.join(state, `${n}.log`); writeFileSync(f, ""); return ["ignore", "ignore", "ignore"].map(() => "ignore"); };
  void log;
  const start = (name, file, args, env = {}) => {
    const p = spawn(process.execPath, [file, ...args], { cwd: apiDir, detached: true, stdio: "ignore", env: { ...process.env, ...env } });
    p.unref();
    writeFileSync(path.join(state, `${name}.pid`), String(p.pid));
  };
  start("api", path.join(out, "main.js"), [], {
    NODE_ENV: "development", PORT: "4001", DATABASE_URL: URL_DB, PUBLIC_BASE_URL: "http://localhost:4001", KIOREX_PAY_LINK_BASE_URL: "http://localhost:4001/api/v1/pay/links",
    PHARMACY_TAKE_RATE_BPS: "400", LAB_TAKE_RATE_BPS: "400", FEE_STATEMENT_VAT_BPS: "1400", // test-only values; real rates are NEEDS_HUMAN
    STORAGE_LOCAL_DIR: path.join(state, "vault"), JOBS_ENABLED: "true", MESSAGING_MODE: "mock", VIDEO_MODE: "mock", PSP_MODE: "sandbox-fake",
  });
  await waitFor("http://localhost:4001/api/v1/health/ready");
  writeFileSync(path.join(state, "up"), new Date().toISOString());
  console.log("[verticals] up: API :4001 (db " + DB + ")");
} else if (cmd === "down") {
  stopAll();
  console.log("[verticals] down (database " + DB + " kept; DROP DATABASE " + DB + " to reset)");
} else {
  console.error("usage: node e2e/verticals/stack.mjs up|down"); process.exit(2);
}
