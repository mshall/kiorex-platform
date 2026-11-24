/**
 * Container PID 1 of the Kiorex API image: optional DB secret -> DATABASE_URL, optional `prisma migrate deploy` (PRISMA_MIGRATE_ON_BOOT=true),
 * then the Nest server (which also mounts the public site when SITE_ROLE is all or site). Seeding never runs on boot (KX-21 section 09).
 * The Secrets Manager client is loaded only here, outside src/ (the no-@aws-sdk-outside-adapters rule covers the application code).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const log = (m) => process.stderr.write(`[boot] ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vpce = (h) => (h && typeof h === "string" ? `https://${h.trim().replace(/^Z[a-z0-9]+:(?=vpce-)/i, "")}` : undefined);

async function loadDatabaseUrl(arn) {
  for (let attempt = 1; ; attempt++) {
    try {
      const sdk = await import("@aws-sdk/client-secrets-manager");
      const ep = vpce(process.env.SECRETS_MANAGER_VPCE_HOST);
      const client = new sdk.SecretsManagerClient({ region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "eu-central-1", ...(ep ? { endpoint: ep } : {}) });
      const j = JSON.parse((await client.send(new sdk.GetSecretValueCommand({ SecretId: arn }))).SecretString ?? "{}");
      const host = j.host ?? j.hostname ?? j.endpoint;
      if (!host) throw new Error("DB secret JSON has no host");
      process.env.DATABASE_URL = `postgresql://${encodeURIComponent(String(j.username ?? ""))}:${encodeURIComponent(String(j.password ?? ""))}@${host}:${j.port ?? 5432}/${j.dbname ?? j.database ?? "postgres"}?schema=public&sslmode=no-verify`;
      log(`DATABASE_URL built for ${host}`); // host only, never the credentials
      return;
    } catch (e) {
      log(`DB secret fetch attempt ${attempt} failed: ${e?.message ?? e}`);
      await sleep(Math.min(30_000, 750 * 2 ** Math.min(attempt - 1, 6)));
    }
  }
}

const run = (cmd, args) => new Promise((resolve) => {
  const c = spawn(cmd, args, { stdio: "inherit", env: process.env, cwd: here });
  c.on("error", () => resolve(127));
  c.on("close", (code) => resolve(code ?? 1));
});

if (process.env.DB_SECRET_ARN && !process.env.DATABASE_URL) await loadDatabaseUrl(process.env.DB_SECRET_ARN);
if (process.env.PRISMA_MIGRATE_ON_BOOT === "true") {
  for (let attempt = 1; ; attempt++) {
    log(`prisma migrate deploy (attempt ${attempt})`);
    if ((await run("prisma", ["migrate", "deploy"])) === 0) break;
    await sleep(Math.min(30_000, 5000 * Math.min(attempt, 6)));
  }
}
const server = spawn(process.execPath, [path.join(here, "dist", "main.js")], { stdio: "inherit", env: process.env });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.kill(sig));
server.on("exit", (code) => process.exit(code ?? 1));
