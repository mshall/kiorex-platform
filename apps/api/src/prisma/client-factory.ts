import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from './generated/client';

export const DEFAULT_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/kiorex_platform?schema=public';

/**
 * Prisma 7 talks to Postgres through the `pg` driver adapter. Our DATABASE_URL keeps the Prisma-style query params
 * (`schema`, `sslmode`, `connection_limit`, `connect_timeout`) that the migration engine and ops runbooks already use,
 * so they are translated here into the adapter / pg pool options instead of being passed to `pg` verbatim.
 */
export function adapterFromUrl(raw: string = process.env.DATABASE_URL ?? DEFAULT_DB_URL): PrismaPg {
  const url = new URL(raw);
  const schema = url.searchParams.get('schema') ?? undefined;
  const sslmode = url.searchParams.get('sslmode');
  const limit = Number(url.searchParams.get('connection_limit'));
  const timeoutSec = Number(url.searchParams.get('connect_timeout'));
  for (const k of ['schema', 'sslmode', 'connection_limit', 'connect_timeout', 'pool_timeout', 'pgbouncer']) url.searchParams.delete(k);
  const pool: PoolConfig = { connectionString: url.toString() };
  if (Number.isFinite(limit) && limit > 0) pool.max = limit;
  // Prisma 6 defaulted to a 5 s connect timeout; node-pg has none, so keep the old bound.
  pool.connectionTimeoutMillis = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : 5000;
  if (sslmode === 'no-verify') pool.ssl = { rejectUnauthorized: false };
  else if (sslmode === 'require' || sslmode === 'verify-full' || sslmode === 'verify-ca') pool.ssl = true;
  return new PrismaPg(pool, schema ? { schema } : undefined);
}

export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient({ adapter: adapterFromUrl(url) });
}
