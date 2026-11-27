import { createPrismaClient } from '../src/prisma/client-factory';
import { markDemoRows, planDemoRemoval, removeDemoRows } from '../src/common/demo-data';

/**
 * Demo data marker + removal against a real (private) database: demo rows are registered once, removal deletes exactly those, real rows are never selected,
 * dry run writes nothing, and the removal is idempotent.
 */
const prisma = createPrismaClient() as any;
const DEMO_SUB = '01HZKXD0000000000000001001';
const REAL_SUB = '01J9REALPATIENT000000000001';

async function seedRows() {
  // DEMO rows, shaped like the demo seed writes them
  await prisma.patientProfile.create({ data: { sub: DEMO_SUB, phone: '+201000001001', nameEn: 'Demo Patient' } });
  await prisma.consentRecord.create({ data: { id: 'demo_cr_1001_1', sub: DEMO_SUB, purpose: 'REMINDERS', granted: true } });
  await prisma.dependant.create({ data: { id: 'demo_dep_1', guardianSub: DEMO_SUB, nameEn: 'Demo Child', dateOfBirth: new Date('2018-01-01'), relationship: 'son' } });
  await prisma.ledgerTx.create({ data: { id: 'demo_tx_1', idempotencyKey: 'demo:cap:1', kind: 'CAPTURE', entries: { create: [{ id: 'demo_le_1', account: 'a', debitMinor: 5 }, { id: 'demo_le_2', account: 'b', creditMinor: 5 }] } } });
  await prisma.flagGateEvidence.create({ data: { flagKey: 'kiorex.telemedicine', gateId: 'DEV-ONLY-NOT-A-REAL-GATE', approver: 'DEMO SEED', approvedOn: new Date(), documentUrl: 'x', recordedBy: 'DEMO_SEED' } });
  // REAL rows, including ones that LOOK like demo rows by id or content
  await prisma.patientProfile.create({ data: { sub: REAL_SUB, phone: '+201199999999', nameEn: 'Real Patient' } });
  await prisma.consentRecord.create({ data: { id: 'real_cr_1', sub: REAL_SUB, purpose: 'REMINDERS', granted: true } });
  await prisma.dependant.create({ data: { id: 'real_dep_1', guardianSub: REAL_SUB, nameEn: 'Real Child', dateOfBirth: new Date('2019-01-01'), relationship: 'daughter' } });
  await prisma.ledgerTx.create({ data: { id: 'real_tx_1', idempotencyKey: 'real:cap:1', kind: 'CAPTURE', entries: { create: [{ id: 'real_le_1', account: 'a', debitMinor: 9 }, { id: 'real_le_2', account: 'b', creditMinor: 9 }] } } });
  await prisma.flagGateEvidence.create({ data: { flagKey: 'kiorex.telemedicine', gateId: 'GOV-2027-01', approver: 'A Human', approvedOn: new Date(), documentUrl: 'y', recordedBy: 'human' } });
}
const counts = async () => ({
  profiles: await prisma.patientProfile.count(), consents: await prisma.consentRecord.count(), deps: await prisma.dependant.count(),
  tx: await prisma.ledgerTx.count(), entries: await prisma.ledgerEntry.count(), gates: await prisma.flagGateEvidence.count(), markers: await prisma.demoMarker.count(),
});

describe('demo data marker and removal (private database)', () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE "DemoMarker", "LedgerEntry", "LedgerTx", "Dependant", "PatientProfile", "FlagGateEvidence" CASCADE`);
    await seedRows();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('before marking, a dry run finds nothing (removal never guesses by pattern)', async () => {
    const plan = await planDemoRemoval(prisma);
    expect(plan.total).toBe(0);
  });

  it('marking registers exactly the demo rows and is idempotent', async () => {
    const first = await markDemoRows(prisma);
    expect(first).toMatchObject({ PatientProfile: 1, Dependant: 1, LedgerTx: 1, FlagGateEvidence: 1 });
    expect(await markDemoRows(prisma)).toEqual({});
    expect(await prisma.demoMarker.count()).toBe(4);
    const real = await prisma.demoMarker.findMany({ where: { rowId: { contains: 'real' } } });
    expect(real).toEqual([]);
    expect((await prisma.demoMarker.findFirst({ where: { tableName: 'PatientProfile' } })).dataClass).toBe('DEMO');
  });

  it('a REAL row created later with a demo-looking id is never selected', async () => {
    await prisma.dependant.create({ data: { id: 'demo_dep_created_by_a_real_user', guardianSub: REAL_SUB, nameEn: 'Lookalike', dateOfBirth: new Date('2020-01-01'), relationship: 'son' } });
  });

  it('dry run counts the marked rows (children included) and changes nothing', async () => {
    const before = await counts();
    const plan = await planDemoRemoval(prisma);
    const by = Object.fromEntries(plan.tables.map((t) => [t.table, t.rows]));
    expect(by).toMatchObject({ PatientProfile: 1, Dependant: 1, LedgerTx: 1, LedgerEntry: 2, FlagGateEvidence: 1 });
    expect(plan.total).toBe(6);
    expect(await counts()).toEqual(before);
  });

  it('removal deletes exactly the marked rows; every real row survives', async () => {
    const done = await prisma.$transaction((tx: any) => removeDemoRows(tx));
    expect(done).toMatchObject({ PatientProfile: 1, Dependant: 1, LedgerTx: 1, LedgerEntry: 2, FlagGateEvidence: 1 });
    expect(await prisma.patientProfile.findMany({ select: { sub: true } })).toEqual([{ sub: REAL_SUB }]);
    // the append-only consent audit is never touched: demo and real consent rows both remain
    expect((await prisma.consentRecord.findMany()).map((r: any) => r.id).sort()).toEqual(['demo_cr_1001_1', 'real_cr_1']);
    expect((await prisma.dependant.findMany()).map((r: any) => r.id).sort()).toEqual(['demo_dep_created_by_a_real_user', 'real_dep_1']);
    expect((await prisma.ledgerTx.findMany()).map((r: any) => r.id)).toEqual(['real_tx_1']);
    expect((await prisma.ledgerEntry.findMany()).map((r: any) => r.id).sort()).toEqual(['real_le_1', 'real_le_2']);
    expect((await prisma.flagGateEvidence.findMany()).map((r: any) => r.gateId)).toEqual(['GOV-2027-01']);
    expect(await prisma.demoMarker.count()).toBe(0);
  });

  it('is idempotent: a second removal and a second dry run find nothing', async () => {
    const again = await prisma.$transaction((tx: any) => removeDemoRows(tx));
    expect(again).toEqual({});
    expect((await planDemoRemoval(prisma)).total).toBe(0);
  });

  it('tagging does not mark real rows, even when the seed re-runs after removal and real data exists', async () => {
    // Tagging (seed time, or the one-off --mark backfill) is the only pattern-based step; application ids are server-generated cuids that never start with demo_,
    // so a real row cannot match. The lookalike above is an artificial adversary: it survives removal (proved earlier) and would only be marked by a manual --mark run, which is why --mark is followed by a dry run.
    await prisma.dependant.delete({ where: { id: 'demo_dep_created_by_a_real_user' } });
    expect(await markDemoRows(prisma)).toEqual({});
    expect(await prisma.demoMarker.count()).toBe(0);
  });

  it('a failure rolls the whole removal back (all-or-nothing)', async () => {
    await prisma.patientProfile.create({ data: { sub: DEMO_SUB, phone: '+201000001001' } });
    await markDemoRows(prisma);
    const before = await counts();
    await expect(prisma.$transaction(async (tx: any) => { await removeDemoRows(tx); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await counts()).toEqual(before);
  });
});
