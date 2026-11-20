/**
 * Dev seed: flag registry (full KX-08 §09 catalogue) + product keys (ff_<product>_dev / ff_dev_secret_change_me).
 * Deliberately seeds NO providers (they come from the Kiorly sync) and NO gate evidence (human-only, ADR-024).
 */
import 'reflect-metadata';
import { createPrismaClient } from '../src/prisma/client-factory';
import { FlagsService } from '../src/control-plane/flags.service';
import { OutboxService } from '../src/outbox/outbox.service';
import { PartnerRegistry } from '../src/partners/partners.service';

async function main() {
  process.env.JOBS_ENABLED = 'false';
  const prisma = createPrismaClient();
  const flags = new FlagsService(prisma as never, new OutboxService(prisma as never));
  await flags.seed({ devKeys: process.env.NODE_ENV !== 'production' });
  if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEV_GATES !== 'false') {
    // DEV ONLY — NOT A REAL GATE. Lets local development and QA use Egypt. Real gate evidence is recorded by a human in the
    // super admin (ADR-024, NEEDS_HUMAN #10); this row is clearly labelled so it can never be mistaken for one, and the
    // seed refuses to run it against production.
    await flags.recordGate('DEV_SEED', 'market.eg.live', { gateId: 'DEV-ONLY-NOT-A-REAL-GATE', approver: 'DEV SEED (not a human approval)', approvedOn: new Date(), documentUrl: 'https://dev.invalid/dev-seed-not-evidence' });
  }
  if (process.env.NODE_ENV !== 'production' && process.env.SEED_DEV_GATES !== 'false') {
    // DEV ONLY — NOT A REAL GATE (Rev 2.3): lets local QA exercise home visits / physio / nursing. Labelled DEV-ONLY-NOT-A-REAL-GATE:<GATE>;
    // never accepted in production. GKN1 (care plans) and GKN2 (individual nurse listing) stay UNRECORDED so the P3 draft keeps its lock.
    for (const [gate, keys] of [['GHV1', ['clinic.home_visits', 'kiorex.home_visits']], ['GHV2', ['clinic.home_visits', 'kiorex.home_visits']], ['GPR1', ['kiorex.category.physiotherapy']]] as const) {
      for (const key of keys) await flags.recordGate('DEV_SEED', key, { gateId: `DEV-ONLY-NOT-A-REAL-GATE:${gate}`, approver: 'DEV SEED (not a human approval)', approvedOn: new Date(), documentUrl: `https://dev.invalid/dev-seed-not-evidence-${gate}` });
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    // DEV partner registrations (kiorex-contracts PARTNER_DEV_DEFAULTS; documented in INTEGRATION.md). Production registrations are made by ops in the super admin.
    const partners = new PartnerRegistry(prisma as never);
    await partners.seedDev('pharmacy');
    await partners.seedDev('lab');
    await partners.seedDev('lab_nurse'); // KNLAB01: second Lab registration with the KIORLY_NURSE client source
  }
  console.log(`seeded ${await prisma.flagDefinition.count()} flag definitions, ${await prisma.productRegistration.count()} products`);
  await prisma.$disconnect();
}
void main();
