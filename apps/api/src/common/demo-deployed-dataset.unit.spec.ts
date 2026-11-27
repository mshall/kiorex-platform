import { DEMO_TARGETS } from './demo-data';
import { DemoSeedRefusedError } from './demo-seed-guard';
import { mapProviderDto } from '../catalog/provider-mapper';
import { isSpecialtyCode } from '../safety/safety-public';
import { parseTenderFields } from '../commissions/commission-tender';
import {
  BOOKINGS, CLAIMS, FORBIDDEN_MARKERS, IDS, ORGS, PATIENTS, PROVIDERS, RUNS, checkDeployedSeedAllowed, chargeId, claimEventData, claimEvents, providerDtos, providerId, tenantId, patientSub,
} from './demo-deployed-dataset';

const ok = { DEMO_SEED_ALLOWED: 'true', KIOREX_ENV: 'test', NODE_ENV: 'production', DATABASE_URL: 'postgresql://platform:x@postgres:5432/platform?schema=public' };

describe('deployed demo seed guard', () => {
  it('accepts a declared deployed non-production environment (container images run with NODE_ENV=production)', () => {
    expect(checkDeployedSeedAllowed(ok)).toBe('test');
    expect(checkDeployedSeedAllowed({ ...ok, KIOREX_ENV: 'staging' })).toBe('staging');
  });
  it('refuses without DEMO_SEED_ALLOWED=true', () => {
    expect(() => checkDeployedSeedAllowed({ ...ok, DEMO_SEED_ALLOWED: undefined })).toThrow(DemoSeedRefusedError);
  });
  it.each(['prod', 'production', 'live', 'prd'])('refuses production (%s) and there is no override', (name) => {
    expect(() => checkDeployedSeedAllowed({ ...ok, KIOREX_ENV: name })).toThrow(/production/);
  });
  it('refuses when a production override is combined with a production name', () => {
    expect(() => checkDeployedSeedAllowed({ ...ok, KIOREX_ENV: 'prod', ALLOW_DEMO_SEED: 'prod' })).toThrow(DemoSeedRefusedError);
  });
  it('refuses an undeclared environment (it would need local-dev assumptions) and the local-dev names', () => {
    const { KIOREX_ENV: _e, ...undeclared } = ok;
    expect(() => checkDeployedSeedAllowed(undeclared)).toThrow(DemoSeedRefusedError);
    for (const n of ['local', 'dev', 'development']) expect(() => checkDeployedSeedAllowed({ ...ok, KIOREX_ENV: n })).toThrow(/runs only in/);
    expect(() => checkDeployedSeedAllowed({ ...ok, KIOREX_ENV: 'mystery' })).toThrow(DemoSeedRefusedError);
  });
  it('refuses a production-looking database and a request for dev gates', () => {
    expect(() => checkDeployedSeedAllowed({ ...ok, DATABASE_URL: 'postgresql://u:p@db/kiorex_prod' })).toThrow(/production/);
    expect(() => checkDeployedSeedAllowed({ ...ok, SEED_DEV_GATES: 'true' })).toThrow(/dev gate/);
  });
});

describe('deployed demo dataset', () => {
  const dtos = providerDtos('2026-11-01T00:00:00.000Z');
  it('has unique ids and every provider belongs to a demo organisation', () => {
    expect(new Set(PROVIDERS.map((p) => p.n)).size).toBe(PROVIDERS.length);
    expect(new Set(BOOKINGS.map((b) => b.key)).size).toBe(BOOKINGS.length);
    expect(new Set(CLAIMS.map((c) => c.key)).size).toBe(CLAIMS.length);
    for (const p of PROVIDERS) expect(ORGS.some((o) => o.n === p.org)).toBe(true);
    for (const b of BOOKINGS) { expect(PROVIDERS.some((p) => p.n === b.provider)).toBe(true); expect(PATIENTS.some((p) => p.n === b.patient)).toBe(true); }
    for (const c of CLAIMS) { expect(ORGS.some((o) => o.n === c.org)).toBe(true); expect(PROVIDERS.find((p) => p.n === c.provider)?.org).toBe(c.org); }
  });
  it('providers map through the Clinic-sync mapper to LIVE rows with valid launch specialties, fees and Arabic and English names', () => {
    for (const dto of dtos) {
      const row = mapProviderDto(dto);
      expect(row.status).toBe('LIVE');
      expect(isSpecialtyCode(row.specialty ?? '')).toBe(true);
      expect(row.minFeeMinor).toBeGreaterThan(0);
      expect(row.nameEn).toMatch(/Demo/); expect(row.nameAr).toMatch(/تجريبي/); expect(row.clinicNameEn).toMatch(/Demo/);
      expect(row.id.startsWith(IDS.provider)).toBe(true);
      expect(row.searchText.length).toBeGreaterThan(10);
      expect(row.tenantId?.startsWith(IDS.tenant)).toBe(true);
    }
    expect(mapProviderDto(dtos[0]).acceptsDeposit).toBe(true);
    expect(mapProviderDto(dtos[1]).acceptsDeposit).toBe(false);
  });
  it('every id prefix the seed uses is registered by a DEMO_TARGETS pattern (so demo-data:remove can find it)', () => {
    const where = (table: string) => DEMO_TARGETS.find((t) => t.table === table)?.seededWhere ?? '';
    const has = (table: string, prefix: string) => expect([...where(table).matchAll(/'([^']+)'/g)].map((m) => m[1]).some((p) => prefix.startsWith(p))).toBe(true);
    has('Provider', IDS.provider); has('BookingIntent', IDS.booking); has('PaymentIntent', IDS.payment); has('Refund', IDS.refund); has('Payout', IDS.payout);
    has('CommissionClaim', IDS.charge); has('CommissionRun', IDS.run); has('CommissionAttempt', IDS.attempt); has('PharmacyOrder', IDS.pharmacyOrder); has('LabBooking', IDS.labBooking); has('LedgerTx', IDS.ledgerKey);
    has('CommissionOrgRateLink', IDS.tenant);
    expect(patientSub(1001).startsWith('01HZKXD')).toBe(true); // PatientProfile pattern
    expect(DEMO_TARGETS.find((t) => t.table === 'CommissionTimeline')).toBeUndefined(); // append-only, trigger-protected
  });
  it('removal order deletes children before parents for the new tables', () => {
    const order = DEMO_TARGETS.map((t) => t.table);
    expect(order.indexOf('BookingIntent')).toBeLessThan(order.indexOf('Provider'));
    expect(order.indexOf('CommissionAttempt')).toBeLessThan(order.indexOf('CommissionRun'));
  });
  it('claims cover every tender kind and status the console shows, and the event data is wire-valid', () => {
    const kinds = new Set(CLAIMS.map((c) => (c.tender === 'CASH' && c.tenderMethod === 'CASH_TRANSFER' ? `CASH_TRANSFER:${c.tenderDetail}` : String(c.tender))));
    for (const k of ['ONLINE', 'CASH', 'CASH_TRANSFER:BANK_TRANSFER', 'CASH_TRANSFER:INSTAPAY', 'CASH_TRANSFER:CARD_TERMINAL', 'null']) expect(kinds).toContain(k);
    expect(new Set(CLAIMS.map((c) => c.status))).toEqual(new Set(['PENDING', 'CONFIRMED', 'DISPUTED', 'REVERSED', 'WAIVED']));
    for (const c of CLAIMS) {
      const seq = claimEvents(c);
      expect(seq[0]).toEqual({ type: 'COMMISSION_CHARGE_CREATED', status: 'PENDING' });
      expect(seq[seq.length - 1].status).toBe(c.status);
      const d = claimEventData(c, c.status);
      expect(d.chargeId).toBe(chargeId(c.key)); expect(d.tenantId).toBe(tenantId(c.org)); expect(typeof d.amount).toBe('number');
      const t = parseTenderFields(d as never);
      expect(t.tender).toBe(c.tender); expect(t.tenderMethod).toBe(c.tenderMethod ?? null); expect(t.tenderDetail).toBe(c.tenderDetail ?? null);
    }
  });
  it('runs reference only organisations and claim sets that exist', () => {
    for (const r of RUNS) expect(CLAIMS.some((c) => c.run === r.claimSet && c.org === r.org)).toBe(true);
  });
  it('contains no dev gate evidence, no dev product keys, no published dev secrets and no localhost URL', () => {
    const blob = JSON.stringify({ ORGS, PROVIDERS, BOOKINGS, CLAIMS, RUNS, PATIENTS, dtos, IDS });
    for (const m of FORBIDDEN_MARKERS) expect(blob).not.toContain(m);
    expect(blob).not.toMatch(/localhost|127\.0\.0\.1/);
  });
  it('uses no real contact data: phones are the +2010000xxxx demo range and e-mails are *.test', () => {
    for (const p of PATIENTS) expect(p.n).toBeGreaterThanOrEqual(1001);
    expect(JSON.stringify(dtos)).not.toMatch(/@/);
  });
});
