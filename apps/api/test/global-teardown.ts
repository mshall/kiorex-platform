import { runDbName } from './db-url';
import { admin } from './global-setup';

/** Drops this run's private database (never when TEST_DATABASE_URL points somewhere shared, or KX_KEEP_TEST_DB is set). */
export default async function () {
  if (process.env.TEST_DATABASE_URL || process.env.KX_KEEP_TEST_DB) return;
  await admin(`DROP DATABASE IF EXISTS "${runDbName()}" WITH (FORCE)`).catch(() => undefined);
}
