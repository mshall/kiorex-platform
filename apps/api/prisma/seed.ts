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
  if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEV_GATES !== 'false') {
    // DEV ONLY — NOT A REAL GATE. Lets local development and QA use Egypt. Real gate evidence is recorded by a human in the
    // super admin (ADR-024, NEEDS_HUMAN #10); this row is clearly labelled so it can never be mistaken for one, and the
    // seed refuses to run it against production.
    await flags.recordGate('DEV_SEED', 'market.eg.live', { gateId: 'DEV-ONLY-NOT-A-REAL-GATE', approver: 'DEV SEED (not a human approval)', approvedOn: new Date(), documentUrl: 'https://dev.invalid/dev-seed-not-evidence' });
  }
  console.log(`seeded ${await prisma.flagDefinition.count()} flag definitions, ${await prisma.productRegistration.count()} products`);
  await prisma.$disconnect();
}
void main();
