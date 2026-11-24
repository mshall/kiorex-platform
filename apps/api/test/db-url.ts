/**
 * Test database URL. TEST_DATABASE_URL wins (CI). Otherwise every jest run gets its OWN Postgres database (`kiorex_platform_test_<pid>_<ts>`),
 * created by global-setup and dropped on teardown, so two concurrent runs (agents, watch mode) can never TRUNCATE each other's rows.
 * (A schema per run does not work: pg_trgm is installed once per database and the init migration needs it on the search path.)
 */
const ADMIN = 'postgresql://postgres:postgres@127.0.0.1:5433/postgres';
export const runDbName = (): string => (process.env.KX_TEST_DB ??= `kiorex_platform_test_${process.pid}_${Date.now().toString(36)}`);
export const adminUrl = (): string => ADMIN;
export const testDatabaseUrl = (): string => process.env.TEST_DATABASE_URL ?? `postgresql://postgres:postgres@127.0.0.1:5433/${runDbName()}?schema=public`;
