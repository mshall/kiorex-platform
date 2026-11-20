import { execSync } from 'node:child_process';
export default async function () {
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/kiorex_platform_test?schema=public' } });
}
