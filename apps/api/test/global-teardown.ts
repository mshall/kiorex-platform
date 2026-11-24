import { runDbName } from './db-url';
import { admin } from './global-setup';

/** Drops this run's private database (never when TEST_DATABASE_URL points somewhere shared, or KX_KEEP_TEST_DB is set). */
export default async function () {
  // the vault directories of this machine's finished runs (the pid is part of the name): remove the ones whose process is gone
  try { const { readdirSync, rmSync } = await import('node:fs'); for (const d of readdirSync('.data').filter((x) => /^test-vault-\d+$/.test(x))) { try { process.kill(Number(d.split('-').pop()), 0); } catch { rmSync(`.data/${d}`, { recursive: true, force: true }); } } } catch { /* nothing to clean */ }
  if (process.env.TEST_DATABASE_URL || process.env.KX_KEEP_TEST_DB) return;
  await admin(`DROP DATABASE IF EXISTS "${runDbName()}" WITH (FORCE)`).catch(() => undefined);
}
