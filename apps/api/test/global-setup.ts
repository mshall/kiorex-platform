import { execSync } from 'node:child_process';
import { Client } from 'pg';
import { adminUrl, runDbName, testDatabaseUrl } from './db-url';

export const admin = async (sql: string) => { const c = new Client({ connectionString: adminUrl() }); await c.connect(); try { await c.query(sql); } finally { await c.end(); } };

export default async function () {
  const own = !process.env.TEST_DATABASE_URL;
  if (own) await admin(`CREATE DATABASE "${runDbName()}"`);
  const url = testDatabaseUrl(); // KX_TEST_DB is set now and inherited by every worker spawned afterwards
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: { ...process.env, DATABASE_URL: url } });
}
