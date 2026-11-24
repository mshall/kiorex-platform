import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { createCtx, TestCtx } from './harness';
import { testDatabaseUrl } from './db-url';
import { GrowthMaintenanceService } from '../src/growth/growth-public';

/**
 * GRW-P1-B0: growth schema. Immutability triggers, unique and CHECK constraints, subject erasure and retention functions (both write AuditLog),
 * additive BookingIntent columns, and an idempotent migration. Real Postgres, no mocks.
 */
describe('growth schema (migration 20261128100000_growth_core)', () => {
  let c: TestCtx; let maint: GrowthMaintenanceService;
  beforeAll(async () => { c = await createCtx(); maint = c.app.get(GrowthMaintenanceService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });

  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
  const HASH = sha('inputs');
  const source = (kind = 'PROVIDER_LINK', ref = 'k7Q2mX9a') => c.prisma.growthAcquisitionSource.create({ data: { sourceKind: kind, sourceRef: ref } });
  const touch = async (o: Record<string, unknown> = {}) => {
    const s = await source('ORGANIC_SEARCH', `g_${Math.random().toString(36).slice(2, 8)}`);
    return c.prisma.growthTouchpoint.create({ data: { sourceId: s.id, kind: 'ORGANIC_SEARCH', landingKind: 'HOME', ipHash: 'abc', ...o } as any });
  };
  const cfg = (o: Record<string, unknown> = {}) => c.prisma.growthConfigVersion.create({ data: { kind: 'ATTRIBUTION_POLICY', version: 1, payload: {}, createdBy: 'a', checksum: sha('{}'), ...o } as any });
  const decision = async (o: Record<string, unknown> = {}) => {
    const v = await cfg({ version: Math.floor(Math.random() * 1e6) + 2 });
    return c.prisma.growthAttributionDecision.create({ data: { bookingId: `kx_bk_${Math.random().toString(36).slice(2, 8)}`, origin: 'PROVIDER_LED', reasonCode: 'EXPLICIT_PROVIDER_CHANNEL', policyVersionId: v.id, inputsHash: HASH, ...o } as any });
  };
  const rejects = (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

  describe('append-only triggers', () => {
    it('GrowthTouchpoint rejects UPDATE and DELETE (also via raw SQL), accepts INSERT', async () => {
      const t = await touch({ visitorKey: 'v1' });
      await rejects(c.prisma.growthTouchpoint.update({ where: { id: t.id }, data: { landingKind: 'DOCTOR' } }), /append-only/);
      await rejects(c.prisma.growthTouchpoint.delete({ where: { id: t.id } }), /append-only/);
      await rejects(c.prisma.$executeRawUnsafe(`UPDATE "GrowthTouchpoint" SET "visitorKey"='x'`), /append-only/);
      await rejects(c.prisma.$executeRawUnsafe(`DELETE FROM "GrowthTouchpoint"`), /append-only/);
      expect(await c.prisma.growthTouchpoint.count()).toBe(1);
    });

    it('GrowthAttributionDecision rejects UPDATE and DELETE; a correction is a new row with supersedesId', async () => {
      const d = await decision();
      await rejects(c.prisma.growthAttributionDecision.update({ where: { id: d.id }, data: { origin: 'MARKETPLACE' } }), /append-only/);
      await rejects(c.prisma.growthAttributionDecision.delete({ where: { id: d.id } }), /append-only/);
      const v2 = await cfg({ version: 99 });
      const fix = await c.prisma.growthAttributionDecision.create({ data: { bookingId: d.bookingId, origin: 'MARKETPLACE', reasonCode: 'MARKETPLACE_TOUCH', policyVersionId: v2.id, inputsHash: HASH, supersedesId: d.id, actor: 'ops:a', note: 'late consent evidence' } });
      expect(fix.supersedesId).toBe(d.id);
      expect(await c.prisma.growthAttributionDecision.count({ where: { bookingId: d.bookingId } })).toBe(2);
    });

    it('a decision cannot be bypassed by the maintenance marker (no personal data lives there)', async () => {
      const d = await decision();
      await rejects(c.prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe(`SELECT set_config('kx.growth_maintenance','on',true)`); await tx.$executeRawUnsafe(`DELETE FROM "GrowthAttributionDecision" WHERE id='${d.id}'`); }), /append-only/);
    });
  });

  describe('unique and CHECK constraints', () => {
    it('one decision per booking and policy version; one per (kind, scope, scopeId, version) config row; one ACTIVE per scope', async () => {
      const d = await decision();
      await rejects(c.prisma.growthAttributionDecision.create({ data: { bookingId: d.bookingId, origin: 'PROVIDER_LED', reasonCode: 'X', policyVersionId: d.policyVersionId, inputsHash: HASH } }), /Unique constraint/);
      await cfg({ version: 7 });
      await rejects(cfg({ version: 7 }), /Unique constraint/);
      await cfg({ version: 8, status: 'ACTIVE', approvedBy: 'b', effectiveFrom: new Date() });
      await rejects(cfg({ version: 9, status: 'ACTIVE', approvedBy: 'b', effectiveFrom: new Date() }), /GrowthConfigVersion_one_active_idx|Unique constraint/);
      await cfg({ version: 9, status: 'ACTIVE', approvedBy: 'b', scope: 'MARKET', scopeId: 'EG', effectiveFrom: new Date() }); // another scope may have its own ACTIVE
    });

    it('config checks: maker-checker, scope shape, status vocabulary, window', async () => {
      await rejects(cfg({ version: 2, approvedBy: 'a' }), /maker_checker/);
      await rejects(cfg({ version: 3, scope: 'MARKET', scopeId: '' }), /scope_check/);
      await rejects(cfg({ version: 4, scope: 'GLOBAL', scopeId: 'EG' }), /scope_check/);
      await rejects(cfg({ version: 5, status: 'LIVE' }), /status_check/);
      await rejects(cfg({ version: 6, effectiveFrom: new Date('2027-01-02'), effectiveTo: new Date('2027-01-01') }), /window_check/);
    });

    it('touch checks: dwell range, no email-like UTM, length-capped UTM', async () => {
      await rejects(touch({ dwellMs: -1 }), /dwell_check/);
      await rejects(touch({ dwellMs: 600001 }), /dwell_check/);
      await rejects(touch({ utmSource: 'a@b.com' }), /utm_no_email/);
      await rejects(touch({ utmCampaign: 'x'.repeat(65) }), /value too long|too long/i);
      await touch({ utmSource: 'google', utmMedium: 'organic', dwellMs: 1800 });
    });

    it('decision checks: origin vocabulary and inputsHash format; BookingIntent.acquisitionOrigin vocabulary', async () => {
      await rejects(decision({ origin: 'NOPE' }), /origin_check/);
      await rejects(decision({ inputsHash: 'abc' }), /hash_check/);
      await rejects(c.prisma.$executeRawUnsafe(`INSERT INTO "BookingIntent" ("id","sub","providerId","clinicId","clinicianId","typeId","startsAt","endsAt","status","updatedAt","acquisitionOrigin") VALUES ('b1','s','p','c','cl','t',now(),now(),'INTENT',now(),'WHATEVER')`), /acquisitionOrigin_check/);
    });

    it('slugs: lowercase ascii 3 to 60; unique per market, type and entity; history keeps old slugs', async () => {
      await rejects(c.prisma.growthSlug.create({ data: { entityType: 'DOCTOR', entityId: 'p1', slug: 'Dr_Amira' } }), /format_check/);
      await rejects(c.prisma.growthSlug.create({ data: { entityType: 'DOCTOR', entityId: 'p1', slug: 'ab' } }), /format_check/);
      await c.prisma.growthSlug.create({ data: { entityType: 'DOCTOR', entityId: 'p1', slug: 'dr-amira' } });
      await rejects(c.prisma.growthSlug.create({ data: { entityType: 'DOCTOR', entityId: 'p2', slug: 'dr-amira' } }), /Unique constraint/);
      await rejects(c.prisma.growthSlug.create({ data: { entityType: 'DOCTOR', entityId: 'p1', slug: 'dr-amira-2' } }), /Unique constraint/);
      await c.prisma.growthSlug.create({ data: { entityType: 'CLINIC', entityId: 'p1', slug: 'dr-amira' } }); // namespace is per entity type
      await c.prisma.growthSlugHistory.create({ data: { entityType: 'DOCTOR', entityId: 'p1', slug: 'old-amira', replacedBy: 'dr-amira' } });
      await rejects(c.prisma.growthSlugHistory.create({ data: { entityType: 'DOCTOR', entityId: 'p9', slug: 'old-amira' } }), /Unique constraint/);
    });

    it('widget registration: https exact origins only, at most 10', async () => {
      const mk = (origins: string[], orgRef = 'org_1') => c.prisma.widgetRegistration.create({ data: { orgRef, origins } });
      await mk(['https://clinic.example.com', 'https://www.nile-clinic.eg', 'https://book.example.com:8443']);
      for (const bad of ['http://clinic.example.com', 'https://*.example.com', 'https://example.com/path', 'https://localhost', 'https://EXAMPLE.com']) {
        await rejects(mk([bad], `org_${bad}`), /origins_check/);
      }
      await rejects(mk(Array.from({ length: 11 }, (_, i) => `https://c${i}.example.com`), 'org_many'), /origins_check/);
      await mk(Array.from({ length: 10 }, (_, i) => `https://c${i}.example.com`), 'org_ten');
    });

    it('suppression is unique per market, channel and address hash and stores no raw address', async () => {
      const row = { channel: 'WHATSAPP', addressHash: sha('+201000000001'), reason: 'STOP' };
      await c.prisma.communicationSuppression.create({ data: row });
      await rejects(c.prisma.communicationSuppression.create({ data: row }), /Unique constraint/);
      await rejects(c.prisma.communicationSuppression.create({ data: { ...row, channel: 'CARRIER_PIGEON', addressHash: 'x' } }), /channel_check/);
      const cols = (await c.prisma.$queryRaw<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_name='CommunicationSuppression'`).map((x) => x.column_name);
      expect(cols).not.toEqual(expect.arrayContaining(['phone']));
      expect(cols).not.toEqual(expect.arrayContaining(['email']));
    });

    it('metric rollup key is unique on the full dimension set (idempotent upsert target)', async () => {
      const k = { day: new Date('2027-03-04'), metric: 'bookings_confirmed', sourceKind: 'PROVIDER_LINK' };
      await c.prisma.growthMetricDaily.create({ data: { ...k, value: 3 } });
      await rejects(c.prisma.growthMetricDaily.create({ data: { ...k, value: 4 } }), /Unique constraint/);
      await c.prisma.growthMetricDaily.create({ data: { ...k, origin: 'PROVIDER_LED', value: 4 } });
    });

    it('every growth table has a market column defaulting to EG', async () => {
      const rows = await c.prisma.$queryRaw<{ table_name: string; column_default: string | null }[]>`SELECT table_name, column_default FROM information_schema.columns WHERE column_name='market' AND table_name IN ('GrowthAcquisitionSource','GrowthTouchpoint','GrowthAttributionDecision','GrowthEvent','GrowthMetricDaily','GrowthSlug','GrowthSlugHistory','GrowthLandingPage','WidgetRegistration','GrowthFraudSignal','CommunicationSuppression')`;
      expect(rows).toHaveLength(11);
      for (const r of rows) expect(r.column_default).toContain("'EG'");
    });
  });

  describe('BookingIntent additive columns', () => {
    it('are nullable and default to null on existing rows', async () => {
      const cols = await c.prisma.$queryRaw<{ column_name: string; is_nullable: string; column_default: string | null }[]>`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='BookingIntent' AND column_name IN ('acquisitionOrigin','attributionDecisionId')`;
      expect(cols).toHaveLength(2);
      for (const col of cols) { expect(col.is_nullable).toBe('YES'); expect(col.column_default).toBeNull(); }
    });
  });

  describe('growth_erase_subject', () => {
    it('deletes the subject\'s touches and linked visitor keys with their events, anonymises cited evidence, audits, leaves others and decisions alone', async () => {
      const keep = await touch({ visitorKey: 'v_other', sub: 'sub_other' });
      const viaKeyOnly = await touch({ visitorKey: 'v_me', sub: null });
      const mine = await touch({ visitorKey: 'v_me', sub: 'sub_me' });
      const cited = await touch({ visitorKey: 'v_me', sub: 'sub_me', clickIdHash: 'h', ltTokenId: 'lt1' });
      const d = await decision({ evidenceTouchIds: [cited.id], lastTouchId: cited.id });
      await c.prisma.growthEvent.createMany({ data: [{ name: 'PageViewed', visitorKey: 'v_me' }, { name: 'PageViewed', visitorKey: 'v_other' }, { name: 'BookingConfirmed', bookingId: d.bookingId }] });

      const r = await maint.eraseSubject('sub_me');
      expect(r).toMatchObject({ touchpointsDeleted: 2, touchpointsAnonymised: 1, eventsDeleted: 1, visitorKeys: 1 }); // GRW-P2-X1: the result also carries the Phase 2 counters
      const left = await c.prisma.growthTouchpoint.findMany({ orderBy: { id: 'asc' } });
      expect(left.map((t) => t.id).sort()).toEqual([keep.id, cited.id].sort());
      expect(left.find((t) => t.id === viaKeyOnly.id)).toBeUndefined();
      expect(left.find((t) => t.id === mine.id)).toBeUndefined();
      const anon = left.find((t) => t.id === cited.id)!;
      expect(anon).toMatchObject({ sub: null, visitorKey: null, ipHash: '', clickIdHash: null, ltTokenId: null, landingKind: 'HOME' });
      expect(await c.prisma.growthEvent.count()).toBe(2);
      expect(await c.prisma.growthEvent.count({ where: { visitorKey: 'v_me' } })).toBe(0);
      expect(await c.prisma.growthAttributionDecision.count()).toBe(1); // decisions untouched
      const audit = await c.prisma.auditLog.findMany({ where: { action: 'growth.erase_subject' } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor: 'system:growth', resource: 'GrowthSubject', resourceId: sha('sub_me') });
      expect(JSON.stringify(audit[0])).not.toContain('sub_me');
      // the table is immutable again after the function returned (marker is transaction-local)
      await rejects(c.prisma.growthTouchpoint.delete({ where: { id: keep.id } }), /append-only/);
    });

    it('is idempotent and rejects an empty subject', async () => {
      await touch({ sub: 'sub_me', visitorKey: 'v' });
      await maint.eraseSubject('sub_me');
      expect(await maint.eraseSubject('sub_me')).toMatchObject({ touchpointsDeleted: 0, touchpointsAnonymised: 0, eventsDeleted: 0, visitorKeys: 0 });
      await rejects(maint.eraseSubject('  '), /sub is required/);
    });
  });

  describe('growth_purge_expired', () => {
    const at = (iso: string) => new Date(iso);
    it('blanks the IP hash after 24 h, deletes unlinked touches after 13 months and decision-cited touches after 25, audits, is idempotent', async () => {
      const now = at('2029-06-01T00:00:00Z');
      const fresh = await touch({ occurredAt: at('2029-05-31T23:00:00Z'), ipHash: 'h1' });
      const dayOld = await touch({ occurredAt: at('2029-05-30T00:00:00Z'), ipHash: 'h2' });
      const unlinkedOld = await touch({ occurredAt: at('2028-04-01T00:00:00Z'), ipHash: '' });
      const unlinkedYoung = await touch({ occurredAt: at('2028-08-01T00:00:00Z'), ipHash: '' });
      const linkedOld = await touch({ occurredAt: at('2027-03-01T00:00:00Z'), ipHash: '' });
      const linkedYoung = await touch({ occurredAt: at('2028-01-01T00:00:00Z'), ipHash: '' });
      await decision({ evidenceTouchIds: [linkedOld.id], firstTouchId: linkedYoung.id });
      await c.prisma.growthEvent.createMany({ data: [{ name: 'PageViewed', occurredAt: at('2027-01-01') }, { name: 'PageViewed', occurredAt: at('2029-05-01') }] });
      await c.prisma.growthFraudSignal.createMany({ data: [{ ruleId: 'burst', subjectHash: 'x', createdAt: at('2028-01-01') }, { ruleId: 'burst', subjectHash: 'y', createdAt: at('2029-05-01') }] });

      const r = await maint.purgeExpired({ now });
      expect(r).toMatchObject({ ipHashBlanked: 1, touchpointsDeletedUnlinked: 1, touchpointsDeletedLinked: 1, eventsDeleted: 1, fraudSignalsDeleted: 1 });
      const ids = (await c.prisma.growthTouchpoint.findMany()).map((t) => t.id).sort();
      expect(ids).toEqual([fresh.id, dayOld.id, unlinkedYoung.id, linkedYoung.id].sort());
      expect((await c.prisma.growthTouchpoint.findUniqueOrThrow({ where: { id: dayOld.id } })).ipHash).toBe('');
      expect((await c.prisma.growthTouchpoint.findUniqueOrThrow({ where: { id: fresh.id } })).ipHash).toBe('h1');
      expect(await c.prisma.auditLog.count({ where: { action: 'growth.purge_expired' } })).toBe(1);
      expect(await maint.purgeExpired({ now })).toMatchObject({ ipHashBlanked: 0, touchpointsDeletedUnlinked: 0, touchpointsDeletedLinked: 0, eventsDeleted: 0, fraudSignalsDeleted: 0 });
      await rejects(maint.purgeExpired({ now, linkedMonths: 0 }), /retention months/);
    });
  });

  describe('migration is idempotent and additive', () => {
    it('running the SQL a second time changes nothing and does not error', async () => {
      const sql = readFileSync(join(__dirname, '..', 'prisma', 'migrations', '20261128100000_growth_core', 'migration.sql'), 'utf8');
      const client = new Client({ connectionString: testDatabaseUrl().replace(/\?schema=.*$/, '') });
      await client.connect();
      try {
        const before = (await client.query(`SELECT count(*)::int AS n FROM pg_constraint`)).rows[0].n;
        await client.query(sql);
        // Replaying growth_core re-creates the 7-column unique index on GrowthMetricDaily that growth_analytics_v1 replaced with the full-dimension key. Left in place it made every
        // later suite of the run (growth analytics rollup) fail with a unique violation, because three providers' rows differ only in columns the narrow index does not cover.
        // So the replay continues with the later migration that supersedes it, exactly like a real upgrade path, and the shared test DB ends in its migrated state.
        await client.query(readFileSync(join(__dirname, '..', 'prisma', 'migrations', '20261129090000_growth_analytics_v1', 'migration.sql'), 'utf8'));
        // GRW-P2-X1: growth_analytics_v1 re-creates the 17-column GrowthMetricDaily_dim_key, which 20261203090000 supersedes with dim2 (campaignId in the key): replay that one too
        await client.query(readFileSync(join(__dirname, '..', 'prisma', 'migrations', '20261203090000_growth_p2_campaigns', 'migration.sql'), 'utf8'));
        // growth_core also re-creates the Phase 1 growth_erase_subject; the Phase 2 migrations that REPLACE it (erase and retention v2, credit ledger v2) are replayed in order, or a later suite erases without the Phase 2 tables
        for (const m of ['20261203095000_growth_p2_erase_retention_v2', '20261203096000_growth_p2_credit_ledger_v2']) await client.query(readFileSync(join(__dirname, '..', 'prisma', 'migrations', m, 'migration.sql'), 'utf8'));
        const after = (await client.query(`SELECT count(*)::int AS n FROM pg_constraint`)).rows[0].n;
        expect(after).toBe(before);
        expect((await client.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('growth_touchpoint_immutable','growth_attribution_decision_immutable')`)).rows[0].n).toBe(2);
      } finally { await client.end(); }
    });

    it('contains no DROP, TRUNCATE or destructive ALTER of an existing table', () => {
      const sql = readFileSync(join(__dirname, '..', 'prisma', 'migrations', '20261128100000_growth_core', 'migration.sql'), 'utf8');
      expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX)\b/i);
      expect(sql).not.toMatch(/\bTRUNCATE\s+"/i);
      expect(sql).not.toMatch(/ALTER TABLE "(?!BookingIntent")\w+" (DROP|ALTER COLUMN|RENAME)/i);
    });
  });
});
