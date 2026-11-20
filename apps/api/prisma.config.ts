import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7: connection URLs live here (not in schema.prisma) and .env is no longer auto-loaded.
// `prisma generate` does not connect, so a placeholder keeps image builds / CI generate steps working without a database.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/kiorex_platform?schema=public',
  },
});
