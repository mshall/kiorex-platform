// Isolated "home visits" stack for the Rev 2.3 UI journeys.
//
// WHY ISOLATED: the home-visit flags are launch-locked (ADR-024); application code never records a gate. The API's dev seed records clearly
// labelled DEV-ONLY-NOT-A-REAL-GATE rows for GHV1, GHV2 and GPR1 (and leaves GKN1/GKN2 unrecorded, so care plans stay awaiting-gate) in a THROWAWAY
// database (kiorex_e2e_home). Partners: real Passport :4400 (must be running) + the API's own HMAC-verifying fake Kiorly (see fake-kiorly-server.cts):
// the real Kiorly Clinic needs a clinic org with home visits enabled, which is the clinic agent's domain.
//   node e2e/home/stack.mjs up | down        (then: npx playwright test -c playwright.home.config.ts ; ops: npx playwright test -c playwright.home.config.ts in apps/ops)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, "../../../api");
const state = path.join(here, ".state");
const PSQL = process.env.PSQL ?? "/Users/postgres/bin/psql";
const DB = "kiorex_e2e_home";
const URL_DB = `postgresql://postgres:postgres@127.0.0.1:5433/${DB}?schema=public`;
const psql = (db, sql) => execFileSync(PSQL, ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-tAc", sql], { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" });
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: apiDir, env: { ...process.env, ...env }, stdio: "inherit" });
const waitFor = async (url, ms = 90_000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if ((await fetch(url)).ok) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 700)); } throw new Error(`timeout waiting for ${url}`); };
const cmd = process.argv[2];
mkdirSync(state, { recursive: true });

const stopAll = () => {
  for (const n of ["api", "fake"]) {
    const f = path.join(state, `${n}.pid`);
    if (existsSync(f)) { try { process.kill(-Number(readFileSync(f, "utf8")), "SIGTERM"); } catch { try { process.kill(Number(readFileSync(f, "utf8")), "SIGTERM"); } catch { /* gone */ } } }
  }
};
const start = (name, file, args, env = {}) => {
  const p = spawn(process.execPath, [...(/\.c?ts$/.test(file) ? ["-r", "ts-node/register/transpile-only"] : []), file, ...args], { cwd: apiDir, detached: true, stdio: ["ignore", openSync(path.join(state, `${name}.log`), "w"), openSync(path.join(state, `${name}.log`), "a")], env: { ...process.env, ...env } });
  p.unref();
  writeFileSync(path.join(state, `${name}.pid`), String(p.pid));
};

if (cmd === "up") {
  stopAll(); await new Promise((r) => setTimeout(r, 2000));
  if (psql("postgres", `SELECT 1 FROM pg_database WHERE datname='${DB}'`).trim() === "1") { try { psql("postgres", `DROP DATABASE ${DB} WITH (FORCE)`); } catch { /* in use */ } }
  if (psql("postgres", `SELECT 1 FROM pg_database WHERE datname='${DB}'`).trim() !== "1") psql("postgres", `CREATE DATABASE ${DB}`);
  run("npx", ["prisma", "migrate", "deploy"], { DATABASE_URL: URL_DB });
  run("npx", ["ts-node", "--transpile-only", "prisma/seed.ts"], { DATABASE_URL: URL_DB, NODE_ENV: "development" }); // records DEV-ONLY GHV1/GHV2/GPR1 rows; GKN1/GKN2 stay unrecorded
  console.log("[home] compiling API…");
  const out = path.join(here, ".api-dist");
  run("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", out, "--incremental", "false"]);
  writeFileSync(path.join(out, "package.json"), '{"type":"commonjs"}');
  const portFile = path.join(state, "fake.port"); rmSync(portFile, { force: true });
  start("fake", path.join(here, "fake-kiorly-server.cts"), [portFile]);
  for (let i = 0; i < 60 && !existsSync(portFile); i++) await new Promise((r) => setTimeout(r, 500));
  const fakePort = readFileSync(portFile, "utf8").trim();
  start("api", path.join(out, "main.js"), [], {
    NODE_ENV: "development", PORT: "4001", DATABASE_URL: URL_DB, PUBLIC_BASE_URL: "http://localhost:4001", PUBLIC_APP_URL: "http://localhost:5180", KIORLY_BASE_URL: `http://127.0.0.1:${fakePort}/marketplace/v1`,
    HOME_DEPOSIT_DEFAULT_MINOR: "10000", // test-only value; the real amount is a KX-12 decision (NEEDS_HUMAN)
    STORAGE_LOCAL_DIR: path.join(state, "vault"), JOBS_ENABLED: "true", MESSAGING_MODE: "mock", VIDEO_MODE: "mock", PSP_MODE: "sandbox-fake", SAFETY_DELIVERY_MODE: "mock",
  });
  await waitFor("http://localhost:4001/api/v1/health/ready");
  const sync = await fetch("http://localhost:4001/api/v1/health/ready"); void sync;
  writeFileSync(path.join(state, "up"), new Date().toISOString());
  console.log(`[home] up: API :4001 (db ${DB}), fake Kiorly :${fakePort}`);
} else if (cmd === "down") {
  stopAll();
  console.log("[home] down (database " + DB + " dropped on next up)");
} else { console.error("usage: node e2e/home/stack.mjs up|down"); process.exit(2); }
