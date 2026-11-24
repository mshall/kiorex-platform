import { createCtx, TestCtx } from './harness';
import { AttributionService } from '../src/growth/growth-public';
import { LifecyclePolicyService } from '../src/growth/lifecycle/lifecycle-policy.service';
import { PreferenceCentreService } from '../src/patient/consent/preference-centre.service';
import { MarketProfileService, marketFacts, marketProfile, marketTimezone, setMarketProfileSnapshot } from '../src/market/market-public';
import { seedBooking } from './growth-helpers';

const BASE = '/api/v1/admin/growth/market-onboarding';
const CFG = '/api/v1/ops/growth/config';
type Auth = Record<string, string>;
const csv = (rows: string[]) => ['level,key,parentKey,nameAr,nameEn,slugAr,slugEn', ...rows].join('\n');
const GEO = csv(['CITY,amman,,عمّان,Amman,amman,amman', 'CITY,irbid,,إربد,Irbid,irbid,irbid', 'DISTRICT,abdoun,amman,عبدون,Abdoun,abdoun,abdoun', 'DISTRICT,sweileh,amman,صويلح,Sweileh,sweileh,sweileh']);
const identity = { name: { ar: 'زد واي', en: 'Zeta Yankee' }, currency: 'JOD', minorUnits: 3, phoneCode: '+962', timezone: 'Asia/Amman', locales: ['ar', 'en'], defaultLocale: 'ar', quietHours: { start: '22:00', end: '08:00' }, workingWeek: [0, 1, 2, 3, 4] };
const regulation = { marketingLicenceRequired: true, marketingLicenceHeld: false, consentRegimeId: 'zy-regime-v0', minimumAge: 18, healthAdvertisingRestricted: true, reviewMarkupAllowed: false, dataExportRuleId: 'zy-export-v0' };
const consent = { textVersionIds: { analytics: 'TODO_NEEDS_HUMAN_v0', marketing: 'TODO_NEEDS_HUMAN_v0' }, maxMarketingPerDay: 1, maxMarketingPerWeek: 2 };

/**
 * GRW-P3-G and GRW-GC-4b: the synthetic market ZY is created ONLY through the wizard API and configuration versions. No source file changes during the run: the registry resolves ZY from
 * configuration and the literal scan (also run here over the real tree) passes. Real Postgres, real Nest app, two super admins.
 */
describe('market ZY through the wizard (no code change)', () => {
  let c: TestCtx; let A: Auth; let B: Auth; let ops: Auth; let patient: Auth;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { setMarketProfileSnapshot([]); await c.close(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); setMarketProfileSnapshot([]); A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); patient = await c.as('p_1'); });
  const step = (cc: string, s: string, body: unknown, who = A) => c.http().put(`${BASE}/plans/${cc}/steps/${s}`).set(who).send(body as object);
  async function planZy(create = true) {
    if (create) await c.http().post(`${BASE}/plans`).set(A).send({ cc: 'ZY' }).expect(201);
    await step('ZY', 'identity', identity).expect(200); await step('ZY', 'regulation', regulation).expect(200); await step('ZY', 'consent', consent).expect(200);
    await step('ZY', 'residency', { dataCellId: 'frankfurt' }).expect(200); await step('ZY', 'providers', { importBatchId: 'imp_zy_batch_1' }).expect(200);
    await step('ZY', 'specialties', { enabled: [{ code: 'dermatology', nameAr: 'الجلدية', nameEn: 'Dermatology' }, { code: 'paediatrics', nameAr: 'الأطفال', nameEn: 'Paediatrics' }] }).expect(200);
    await step('ZY', 'integrations', { whatsappPhoneNumberIdRef: null }).expect(200);
    await c.http().post(`${BASE}/plans/ZY/geography`).set(A).send({ csv: GEO }).expect(200);
  }
  async function publishAndApprove() {
    const res = await c.http().post(`${BASE}/plans/ZY/publish`).set(A); if (res.status !== 200) throw new Error(JSON.stringify(res.body)); const pub = res.body;
    for (const k of ['MARKET_PROFILE', 'MARKET_GROWTH', 'CONSENT_DEFAULTS']) await c.http().post(`${CFG}/${pub.drafted[k].id}/approve`).set(B).expect(200);
    await c.get(MarketProfileService).refresh(); c.flags.invalidate(); return pub;
  }

  describe('the API', () => {
    it('roles, validation and the guard rails: ops reads but cannot write, EG SA AE and duplicates are refused, bad answers say why, an unknown data cell is refused', async () => {
      await c.http().get(`${BASE}/plans`).expect(401); await c.http().get(`${BASE}/plans`).set(patient).expect(403);
      await c.http().get(`${BASE}/catalogue`).set(ops).expect(200); await c.http().post(`${BASE}/plans`).set(ops).send({ cc: 'ZY' }).expect(403);
      for (const cc of ['EG', 'SA', 'AE']) expect((await c.http().post(`${BASE}/plans`).set(A).send({ cc }).expect(409)).body.code).toBe('MARKET_EXISTS');
      await c.http().post(`${BASE}/plans`).set(A).send({ cc: 'zy' }).expect(400); await c.http().post(`${BASE}/plans`).set(A).send({ cc: 'ZYX' }).expect(400);
      await c.http().post(`${BASE}/plans`).set(A).send({ cc: 'ZY' }).expect(201); expect((await c.http().post(`${BASE}/plans`).set(A).send({ cc: 'ZY' }).expect(409)).body.code).toBe('MARKET_PLAN_EXISTS');
      await c.http().get(`${BASE}/plans/QQ`).set(ops).expect(404);
      const bad = await step('ZY', 'identity', { ...identity, currency: 'jod', timezone: 'Mars/Olympus', locales: ['fr'], quietHours: { start: '22:00', end: '22:00' } }).expect(422);
      expect(bad.body.errors.length ?? bad.body.details?.errors?.length).toBeGreaterThanOrEqual(4);
      const cell = await step('ZY', 'residency', { dataCellId: 'mars' }).expect(422); expect(JSON.stringify(cell.body)).toMatch(/unknown cell is refused/);
      await step('ZY', 'specialties', { enabled: [{ code: 'not-a-specialty', nameAr: 'x', nameEn: 'x' }] }).expect(422);
      await step('ZY', 'regulation', { ...regulation, marketingLicenceHeld: true, marketingLicenceRequired: false }).expect(422);
      await step('ZY', 'geography', {}).expect(422); await step('ZY', 'nonsense', {}).expect(400);
      await step('ZY', 'identity', identity, ops).expect(403);
    });

    it('geography CSV: a clean file imports all or nothing; BOM and Arabic work; a bad file imports nothing and names the line', async () => {
      await c.http().post(`${BASE}/plans`).set(A).send({ cc: 'ZY' }).expect(201);
      const pv = (await c.http().post(`${BASE}/geography/preview`).set(ops).send({ csv: `﻿${GEO}` }).expect(200)).body;
      expect(pv).toMatchObject({ ok: true, cities: 2, districts: 2 }); expect(await c.prisma.marketGeography.count()).toBe(0); // a preview writes nothing
      await c.http().post(`${BASE}/plans/ZY/geography`).set(A).send({ csv: `﻿${GEO}` }).expect(200);
      expect(await c.prisma.marketGeography.count({ where: { market: 'ZY' } })).toBe(4); expect(await c.prisma.growthSlug.count({ where: { market: 'ZY' } })).toBe(4);
      const geo = (await c.http().get(`${BASE}/plans/ZY/geography?level=DISTRICT`).set(ops).expect(200)).body; expect(geo.map((g: { key: string }) => g.key)).toEqual(['abdoun', 'sweileh']);
      const dup = csv(['CITY,a1,,عمان,Amman,amman,amman', 'CITY,a2,,عمان٢,Amman Two,amman2,amman']);
      const r = await c.http().post(`${BASE}/plans/ZY/geography`).set(A).send({ csv: dup }).expect(422); expect(r.body.errors[0]).toMatchObject({ line: 3, code: 'DUPLICATE_SLUG' });
      expect(await c.prisma.marketGeography.count({ where: { market: 'ZY' } })).toBe(4); // the failed import changed nothing
    });

    it('CSV edge cases: CP1256 bytes, replacement characters, RTL override, formulas, duplicate keys, an orphan district, a missing header, 20,001 rows refused and 20,000 accepted', async () => {
      const pv = async (b: object) => (await c.http().post(`${BASE}/geography/preview`).set(A).send(b).expect(200)).body;
      const text = csv(['CITY,amman,,عمّان,Amman,amman,amman']);
      const cp1256 = Buffer.from([...Buffer.from('level,key,parentKey,nameAr,nameEn,slugAr,slugEn\nCITY,amman,,', 'ascii'), 0xDA, 0xE3, 0xC7, 0xE4, ...Buffer.from(',Amman,amman,amman', 'ascii')]);
      expect((await pv({ csvBase64: cp1256.toString('base64') })).errors[0].code).toBe('ENCODING_NOT_UTF8'); // CP1256 sent as UTF-8
      const ok = await pv({ csvBase64: cp1256.toString('base64'), encoding: 'windows-1256' }); expect(ok).toMatchObject({ ok: true, cities: 1 }); expect(ok.sample[0].nameAr).toBe('عمان');
      expect((await pv({ csv: text.replace('Amman', 'Am�man') })).errors[0].code).toBe('ENCODING_NOT_UTF8');
      expect((await pv({ csv: csv(['CITY,amman,,عمّان,Am‮man,amman,amman']) })).errors[0].code).toBe('BAD_CHARACTER');
      expect((await pv({ csv: csv(['CITY,amman,,=SUM(A1),Amman,amman,amman']) })).errors[0].code).toBe('FORMULA');
      expect((await pv({ csv: csv(['CITY,amman,,عمّان,Amman,amman,amman', 'CITY,amman,,إربد,Irbid,irbid,irbid']) })).errors[0].code).toBe('DUPLICATE_KEY');
      expect((await pv({ csv: csv(['DISTRICT,abdoun,nowhere,عبدون,Abdoun,abdoun,abdoun']) })).errors[0].code).toBe('PARENT_UNKNOWN');
      expect((await pv({ csv: 'level,nameEn\nCITY,x' })).errors[0].code).toBe('HEADER_MISSING');
      expect((await pv({ csv: csv(['TOWN,x,,عمّان,Amman,amman,amman']) })).errors[0].code).toBe('LEVEL');
      const rows = (n: number) => csv(Array.from({ length: n }, (_, i) => `CITY,c${i},,مدينة ${i},City ${i},city-${i}-x,city-${i}-y`));
      expect((await pv({ csv: rows(20_001) })).errors[0].code).toBe('TOO_MANY_ROWS');
      await c.http().post(`${BASE}/plans`).set(A).send({ cc: 'ZY' }).expect(201);
      const big = await c.http().post(`${BASE}/plans/ZY/geography`).set(A).send({ csv: rows(20_000) }).expect(200); expect(big.body.cities).toBe(20_000);
      expect(await c.prisma.marketGeography.count({ where: { market: 'ZY' } })).toBe(20_000);
    }, 120_000);

    it('readiness is accurate: TODO until the steps, versions and flag exist, AWAITING_CHECKER while a version waits, NEEDS_HUMAN for counsel items and the launch gate, never "live" by itself', async () => {
      await c.http().post(`${BASE}/plans`).set(A).send({ cc: 'ZY' }).expect(201);
      const empty = (await c.http().get(`${BASE}/plans/ZY/readiness`).set(ops).expect(200)).body;
      expect(empty).toMatchObject({ ready: false, live: false }); expect(empty.items.find((i: { id: string }) => i.id === 'identity').status).toBe('TODO');
      await planZy(false);
      const mid = (await c.http().get(`${BASE}/plans/ZY/readiness`).set(ops).expect(200)).body; const st = (b: typeof mid, id: string) => b.items.find((i: { id: string }) => i.id === id).status;
      expect(['identity', 'geography', 'specialties', 'regulation', 'providers', 'consent', 'residency', 'integrations'].map((i) => st(mid, i))).toEqual(Array(8).fill('DONE'));
      expect(st(mid, 'configVersions')).toBe('TODO'); expect(st(mid, 'flagDefinition')).toBe('TODO'); expect(st(mid, 'consentTexts')).toBe('NEEDS_HUMAN'); expect(st(mid, 'launchGate')).toBe('NEEDS_HUMAN'); expect(st(mid, 'legalTexts')).toBe('NEEDS_HUMAN');
      expect(mid.sameCellMarkets).toContain('EG'); // one cell today: the second market maps to the same cell
      await c.http().post(`${BASE}/plans/ZY/publish`).set(A).expect(200);
      expect(st((await c.http().get(`${BASE}/plans/ZY/readiness`).set(ops)).body, 'configVersions')).toBe('AWAITING_CHECKER');
    });
  });

  describe('publish, the second approver, and the registry', () => {
    it('publish needs the answers; the maker cannot approve their own versions; after the second admin approves, ZY resolves from configuration with no source change and EG is untouched', async () => {
      await c.http().post(`${BASE}/plans`).set(A).send({ cc: 'ZY' }).expect(201);
      expect((await c.http().post(`${BASE}/plans/ZY/publish`).set(A).expect(422)).body.code).toBe('MARKET_PLAN_INCOMPLETE');
      await planZy(false);
      await c.http().post(`${BASE}/plans/ZY/publish`).set(ops).expect(403);
      const pub = (await c.http().post(`${BASE}/plans/ZY/publish`).set(A).expect(200)).body;
      expect(Object.keys(pub.drafted).sort()).toEqual(['CONSENT_DEFAULTS', 'MARKET_GROWTH', 'MARKET_PROFILE']); expect(pub.drafted.MARKET_PROFILE.status).toBe('PENDING_APPROVAL');
      await c.http().post(`${CFG}/${pub.drafted.MARKET_PROFILE.id}/approve`).set(A).expect(403); // maker-checker
      expect(marketProfile('ZY')).toBeUndefined(); expect(marketTimezone('ZY')).toBe('UTC'); // nothing resolves before approval
      
      for (const k of ['MARKET_PROFILE', 'MARKET_GROWTH', 'CONSENT_DEFAULTS']) await c.http().post(`${CFG}/${pub.drafted[k].id}/approve`).set(B).expect(200);
      await c.get(MarketProfileService).refresh();
      expect(marketFacts('ZY')).toEqual({ currency: 'JOD', phoneCode: '+962', name: { ar: 'زد واي', en: 'Zeta Yankee' } }); expect(marketTimezone('ZY')).toBe('Asia/Amman');
      expect(marketProfile('ZY')).toMatchObject({ minorUnits: 3, canonicalSegment: 'zy', dataCellId: 'frankfurt', geographyRef: 'market-geography/zy', regulation: { marketingLicenceHeld: false } });
      expect(marketFacts('EG').currency).toBe('EGP'); expect(marketTimezone('EG')).toBe('Africa/Cairo');
      const r = (await c.http().get(`${BASE}/plans/ZY/readiness`).set(ops).expect(200)).body; expect(r.items.find((i: { id: string }) => i.id === 'configVersions').status).toBe('DONE'); expect(r.items.find((i: { id: string }) => i.id === 'flagDefinition').status).toBe('DONE');
      expect(r.live).toBe(false); expect(r.items.find((i: { id: string }) => i.id === 'launchGate').status).toBe('NEEDS_HUMAN');
      expect(await c.prisma.auditLog.count({ where: { action: { startsWith: 'growth.market_onboarding.' }, resourceId: 'ZY' } })).toBeGreaterThanOrEqual(10);
    });

    it('a bad profile version in the database is ignored by the resolver (the market stays on its fallback or unknown, never half-configured)', async () => {
      await c.prisma.growthConfigVersion.create({ data: { kind: 'MARKET_PROFILE', scope: 'MARKET', scopeId: 'SA', version: 1, status: 'ACTIVE', payload: { cc: 'SA', currency: 'XXXX' }, effectiveFrom: new Date(0), createdBy: 'adm_a', approvedBy: 'adm_b', checksum: 'x'.repeat(64) } as never });
      await c.get(MarketProfileService).refresh(); expect(marketFacts('SA').currency).toBe('SAR');
    });
  });

  describe('every consumer reads the registry (the ZY checklist of the package)', () => {
    beforeEach(async () => { await planZy(); await publishAndApprove(); });
    const gate = async () => { await c.flags.recordGate('test', 'market.zy.live', { gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'x', approvedOn: new Date(), documentUrl: 'https://dev.invalid/x' }); c.flags.invalidate(); };

    it('flag market.zy.live OFF hides ZY from sign-up and bootstrap; once a person records the gate, bootstrap lists ZY with JOD, +962 and the selector appears', async () => {
      expect((await c.http().get('/api/v1/markets').expect(200)).body.map((m: { code: string }) => m.code)).toEqual(['EG']);
      const all = (await c.http().get('/api/v1/markets?all=true').expect(200)).body; expect(all.find((m: { code: string }) => m.code === 'ZY')).toMatchObject({ live: false });
      const before = (await c.http().get('/api/v1/bootstrap?cc=zy').expect(200)).body; expect(before.liveMarkets).toEqual(['EG']); expect(before.resolvedMarket).toBe('EG'); expect(before.showMarketSelector).toBe(false);
      await gate();
      const b = (await c.http().get('/api/v1/bootstrap?cc=zy').expect(200)).body;
      expect(b.liveMarkets).toEqual(['EG', 'ZY']); expect(b.resolvedMarket).toBe('ZY'); expect(b.showMarketSelector).toBe(true);
      expect(b.markets.find((m: { code: string }) => m.code === 'ZY')).toMatchObject({ currency: 'JOD', phoneCode: '+962', name: { ar: 'زد واي', en: 'Zeta Yankee' } });
      expect(b.markets.find((m: { code: string }) => m.code === 'EG')).toMatchObject({ currency: 'EGP', phoneCode: '+20' });
    });

    it('attribution decisions carry market ZY, campaign and lifecycle quiet hours use Asia/Amman, consent defaults come from the ZY version, campaign currency is JOD', async () => {
      const bk = await seedBooking(c, { sub: 'sub_zy1' });
      const d = await c.get(AttributionService).decideForBooking({ bookingId: bk.id, market: 'ZY' }); expect(d).toBeTruthy();
      expect((await c.prisma.growthAttributionDecision.findFirstOrThrow({ where: { bookingId: bk.id } })).market).toBe('ZY');
      const pol = await c.get(LifecyclePolicyService).resolve('ZY'); expect(pol.quiet).toEqual({ start: '22:00', end: '08:00', timezone: 'Asia/Amman' });
      const eg = await c.get(LifecyclePolicyService).resolve('EG'); expect(eg.quiet).toEqual({ start: '21:00', end: '09:00', timezone: 'Africa/Cairo' }); // unchanged
      const cd = await c.get(PreferenceCentreService).consentDefaults('ZY'); expect(cd).toMatchObject({ quietHoursTimezone: 'Asia/Amman', quietHoursStart: '22:00', quietHoursEnd: '08:00', maxMarketingPerWeek: 2 });
      const camp = (await c.http().post('/api/v1/admin/growth/campaigns').set(A).send({ market: 'ZY', key: 'zy-launch', name: 'Launch', objective: 'ACQUISITION', budgetTotalMinor: 1_000_000, budgetDailyMinor: 200_000, channels: ['EMAIL'], startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000 * 20).toISOString(), utmConfig: { targetPath: '/doctors' } }).expect(201)).body;
      expect(camp).toMatchObject({ market: 'ZY', currency: 'JOD', utmCampaign: 'zy-zy-launch' });
    });

    it('analytics are split by market: a ZY event never appears in the EG report and the other way round', async () => {
      await c.prisma.growthEvent.createMany({ data: [{ market: 'ZY', name: 'BookingConfirmed', props: {}, dedupeKey: 'zy|1' }, { market: 'ZY', name: 'BookingConfirmed', props: {}, dedupeKey: 'zy|2' }, { market: 'EG', name: 'BookingConfirmed', props: {}, dedupeKey: 'eg|1' }] });
      const total = (_m: string, body: { events: Array<{ count: number }> }) => body.events.reduce((s, x) => s + x.count, 0);
      const zy = (await c.http().get('/api/v1/ops/growth/analytics?market=ZY&days=7').set(ops).expect(200)).body; const eg = (await c.http().get('/api/v1/ops/growth/analytics?market=EG&days=7').set(ops).expect(200)).body;
      expect(JSON.stringify(zy)).toContain('BookingConfirmed'); expect(total('ZY', zy)).toBe(2); expect(total('EG', eg)).toBe(1);
    });
  });
});
