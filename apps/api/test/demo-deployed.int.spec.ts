import { createCtx, TestCtx } from './harness';
import { seedDeployed } from '../prisma/demo/seed-deployed';
import { CommissionClaimsService } from '../src/commissions/commission-claims.service';
import { planDemoRemoval, removeDemoRows } from '../src/common/demo-data';
import { BOOKINGS, CLAIMS, PROVIDERS, patientSub } from '../src/common/demo-deployed-dataset';

/** The trimmed deployed-environment demo seed against a private database: shape, idempotency, tagging, removal, and no dev gate evidence or product keys. */
describe('deployed demo seed (private database)', () => {
  let c: TestCtx; const quiet = () => undefined;
  const run = () => seedDeployed(c.prisma as any, { claims: c.get(CommissionClaimsService) as any, log: quiet });
  const REAL = { sub: '01J9REALPATIENT000000000009', provider: 'real_provider_1' };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => {
    // ConsentRecord is an append-only audit (trigger); on THIS private test database only, take the seed's consent rows out so other files that count consents are not polluted
    await c.prisma.$executeRawUnsafe('ALTER TABLE "ConsentRecord" DISABLE TRIGGER consent_record_immutable');
    await c.prisma.$executeRawUnsafe(`DELETE FROM "ConsentRecord" WHERE id LIKE 'demo_cr_dx_%'`);
    await c.prisma.$executeRawUnsafe('ALTER TABLE "ConsentRecord" ENABLE TRIGGER consent_record_immutable');
    await c.close();
  });
  beforeEach(async () => { await c.reset(); });

  it('creates providers, bookings, claims (all tender kinds) and runs; the partner part is skipped without partner clients', async () => {
    const r = await run();
    expect(r.providers).toBe(PROVIDERS.length);
    expect(await c.prisma.provider.count({ where: { id: { startsWith: 'demo_dp_' }, status: 'LIVE' } })).toBe(PROVIDERS.length);
    expect(await c.prisma.bookingIntent.count({ where: { id: { startsWith: 'demo_bk_dx' } } })).toBe(BOOKINGS.length);
    expect(await c.prisma.commissionClaim.count()).toBe(CLAIMS.length);
    const kinds = await c.prisma.commissionClaim.findMany({ select: { tender: true, tenderMethod: true, tenderDetail: true } });
    expect(kinds.filter((k: any) => k.tenderMethod === 'CASH_TRANSFER').map((k: any) => k.tenderDetail).sort()).toEqual(['BANK_TRANSFER', 'CARD_TERMINAL', 'INSTAPAY']);
    expect((await c.prisma.commissionClaim.findUniqueOrThrow({ where: { chargeId: 'demo_chg_10' } })).chargeStatus).toBe('REVERSED');
    expect(await c.prisma.commissionRun.count()).toBe(2);
    expect(await c.prisma.commissionClaim.count({ where: { collectionStatus: 'INVOICED' } })).toBeGreaterThan(0);
    expect(await c.prisma.pharmacyOrder.count()).toBe(0);
  });

  it('is idempotent: a second run changes no counts and re-activates nothing', async () => {
    await run();
    const snap = async () => ({
      p: await c.prisma.provider.count(), b: await c.prisma.bookingIntent.count(), pay: await c.prisma.paymentIntent.count(), tx: await c.prisma.ledgerTx.count(), cl: await c.prisma.commissionClaim.count(),
      runs: await c.prisma.commissionRun.count(), tl: await c.prisma.commissionTimeline.count(), rv: await c.prisma.review.count(), m: await c.prisma.demoMarker.count(), po: await c.prisma.payout.count(),
    });
    const a = await snap(); await run(); expect(await snap()).toEqual(a);
    expect((await c.prisma.commissionClaim.findUniqueOrThrow({ where: { chargeId: 'demo_chg_10' } })).chargeStatus).toBe('REVERSED');
  });

  it('records NO dev gate evidence, NO product registrations / keys and NO partner registrations', async () => {
    const gates = await c.prisma.flagGateEvidence.count(); const products = await c.prisma.productRegistration.count(); const partners = await c.prisma.partnerRegistration.count();
    await run();
    expect(await c.prisma.flagGateEvidence.count()).toBe(gates);
    expect(await c.prisma.flagGateEvidence.count({ where: { gateId: { startsWith: 'DEV-ONLY' }, recordedBy: { in: ['DEMO_SEED', 'DEV_SEED'] } } })).toBe(0);
    expect(await c.prisma.productRegistration.count()).toBe(products);
    expect(await c.prisma.partnerRegistration.count()).toBe(partners);
  });

  it('registers every row in DemoMarker; a dry run finds them; removal deletes exactly those and leaves real rows alone', async () => {
    await c.prisma.patientProfile.create({ data: { sub: REAL.sub, phone: '+201199999998', nameEn: 'Real Patient' } });
    await c.prisma.provider.create({ data: { id: REAL.provider, clinicId: 'real_c', clinicianId: 'real_k', status: 'LIVE', sourceVersion: '1', raw: {}, subSpecialties: [], languages: [], searchText: 'real' } as any });
    await run();
    const plan = await planDemoRemoval(c.prisma as any);
    const by = Object.fromEntries(plan.tables.map((t) => [t.table, t.rows]));
    expect(by.Provider).toBe(PROVIDERS.length); expect(by.CommissionClaim).toBe(CLAIMS.length); expect(by.CommissionRun).toBe(2); expect(by.BookingIntent).toBe(BOOKINGS.length);
    expect(by.PatientProfile).toBe(12); expect(by.CommissionOrgRateLink).toBe(4);
    await c.prisma.$transaction(async (tx: any) => { await removeDemoRows(tx); });
    expect(await c.prisma.provider.count()).toBe(1);
    expect(await c.prisma.commissionClaim.count()).toBe(0);
    expect(await c.prisma.commissionRun.count()).toBe(0);
    expect(await c.prisma.commissionAttempt.count()).toBe(0);
    expect(await c.prisma.bookingIntent.count()).toBe(0);
    expect(await c.prisma.ledgerTx.count()).toBe(0);
    expect(await c.prisma.patientProfile.findUnique({ where: { sub: REAL.sub } })).not.toBeNull();
    expect(await c.prisma.patientProfile.findUnique({ where: { sub: patientSub(1001) } })).toBeNull();
  });

  it('demo providers and claims are visible through the patient search and the ops commission API', async () => {
    await run();
    const search = await c.http().get('/api/v1/search/providers?q=demo').expect(200);
    expect(JSON.stringify(search.body)).toContain('Demo');
    const one = await c.http().get('/api/v1/providers/demo_dp_1').expect(200);
    expect(JSON.stringify(one.body)).toContain('Hana');
    const sa = await c.as('sa1', { roles: ['super_admin', 'ops_admin'] });
    const claims = await c.http().get('/api/v1/admin/commissions/claims').set(sa).expect(200);
    expect(JSON.stringify(claims.body)).toContain('CASH_TRANSFER');
    const summary = await c.http().get('/api/v1/admin/commissions/summary').set(sa).expect(200);
    expect(summary.body).toBeTruthy();
  });
});
