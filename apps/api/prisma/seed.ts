/**
 * Dev seed: flag registry (full KX-08 §09 catalogue) + product keys (ff_<product>_dev / ff_dev_secret_change_me).
 * Deliberately seeds NO providers (they come from the Kiorly sync) and NO gate evidence (human-only, ADR-024).
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { FlagsService } from '../src/control-plane/flags.service';
import { OutboxService } from '../src/outbox/outbox.service';

async function main() {
  process.env.JOBS_ENABLED = 'false';
  const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/kiorex_platform?schema=public' });
  const flags = new FlagsService(prisma as never, new OutboxService(prisma as never));
  await flags.seed({ devKeys: process.env.NODE_ENV !== 'production' });
  console.log(`seeded ${await prisma.flagDefinition.count()} flag definitions, ${await prisma.productRegistration.count()} products`);
  await prisma.$disconnect();
}
void main();
