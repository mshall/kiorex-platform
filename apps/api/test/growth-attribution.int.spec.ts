import { signKiorlyRequest, validateAcquisitionBlock } from '@kiorex/contracts';
import { createCtx, TestCtx } from './harness';
import { AttributionService, GrowthConfigService, GROWTH_DEFAULT_PAYLOADS, issueLinkToken, linkTokenKey } from '../src/growth/growth-public';
import { activateConfig, DAY, registerLink, SUPER_A, seedBooking, seedTouch } from './growth-helpers';

const code = async (p: Promise<unknown>) => { try { await p; return 'NO_ERROR'; } catch (e) { return (e as { getResponse(): { code: string } }).getResponse().code; } };

/** GRW-P1-B: decisions end to end (real Postgres): once per policy version, replayable, evidence, corrections, isolation, concurrency, latency. */
describe('attribution decisions', () => {
  let c: TestCtx; let svc: AttributionService;
  beforeAll(async () => { c = await createCtx(); svc = c.get(AttributionService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); });
  const V = 'kxv_aaaaaaaaaaaaaaaaaaaaaa';

  it('a provider touch before the booking makes it PROVIDER_LED with evidence; BookingIntent gets the origin and decision id; AttributionAssigned is queued', async () => {
    const t = await seedTouch(c, { kind: 'PROVIDER_LINK', visitorKey: V, org: 'org_A', ageMs: 2 * DAY, linkCode: '7K2M9X4Q' });
    const b = await seedBooking(c);
    const d = (await svc.decideForBooking({ bookingId: b.id, visitorKey: V }))!;
    expect(d).toMatchObject({ origin: 'PROVIDER_LED', reasonCode: 'PRIOR_PROVIDER_TOUCH', created: true });
    const row = await c.prisma.growthAttributionDecision.findUniqueOrThrow({ where: { id: d.id } });
    expect(row).toMatchObject({ winningTouchId: t.id, evidenceTouchIds: [t.id], bookingId: b.id });
    expect(row.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id }, select: { acquisitionOrigin: true, attributionDecisionId: true } })).toEqual({ acquisitionOrigin: 'PROVIDER_LED', attributionDecisionId: d.id });
    const ev = await c.prisma.outboxEvent.findMany({ where: { type: { in: ['AttributionAssigned', 'PatientAcquisitionRecorded'] } } });
    expect(ev.map((e) => e.type).sort()).toEqual(['AttributionAssigned', 'PatientAcquisitionRecorded']);
    expect(ev.every((e) => e.target === 'INTERNAL')).toBe(true);
    expect(JSON.stringify(ev.map((e) => e.payload))).not.toMatch(/sub_amira|\+20|@/); // no identifier in internal events
  });

  it('no touches, a marketplace touch, a referral, a campaign, another organisation: the origins the founder describes', async () => {
    const mk = async (touches: Parameters<typeof seedTouch>[1][]) => { const key = `kxv_${Math.random().toString(36).slice(2).padEnd(22, 'x')}`; for (const t of touches) await seedTouch(c, { ...t, visitorKey: key }); return (await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, visitorKey: key }))!; };
    expect(await mk([])).toMatchObject({ origin: 'UNATTRIBUTED', reasonCode: 'NO_PROVIDER_EVIDENCE' });
    expect(await mk([{ kind: 'ORGANIC_SEARCH', ageMs: DAY }])).toMatchObject({ origin: 'MARKETPLACE', reasonCode: 'MARKETPLACE_TOUCH' });
    expect(await mk([{ kind: 'REFERRAL', ageMs: DAY, linkCode: 'RFR12345' }])).toMatchObject({ origin: 'MARKETPLACE', reasonCode: 'PATIENT_REFERRAL' });
    expect(await mk([{ kind: 'CAMPAIGN', ageMs: 3 * DAY }])).toMatchObject({ origin: 'MARKETPLACE', reasonCode: 'MARKETPLACE_TOUCH' });
    expect(await mk([{ kind: 'CAMPAIGN', ageMs: 8 * DAY }])).toMatchObject({ origin: 'UNATTRIBUTED' }); // 7 day click window
    expect(await mk([{ kind: 'PROVIDER_LINK', ageMs: DAY, org: 'org_OTHER', linkCode: 'ZZZZ9999' }])).toMatchObject({ origin: 'UNATTRIBUTED' }); // other organisation's touch ignored
    expect(await mk([{ kind: 'PROVIDER_LINK', ageMs: DAY, org: 'org_A', dwellMs: 50, linkCode: 'AAAA1111' }])).toMatchObject({ origin: 'UNATTRIBUTED' }); // click without render
    expect(await mk([{ kind: 'PROVIDER_LINK', ageMs: 31 * DAY, org: 'org_A', linkCode: 'AAAA2222' }])).toMatchObject({ origin: 'UNATTRIBUTED' }); // outside 30 days
  });

  it('a booking on the CLINIC_LINK channel is PROVIDER_LED with no touches (today\'s rule), and a verified lt token for the same org too; a token for ANOTHER org is not', async () => {
    expect(await svc.decideForBooking({ bookingId: (await seedBooking(c, { channel: 'CLINIC_LINK' })).id })).toMatchObject({ origin: 'PROVIDER_LED', reasonCode: 'EXPLICIT_PROVIDER_CHANNEL' });
    const lt = issueLinkToken(linkTokenKey()!, { orgRef: 'org_A', linkCode: '7K2M9X4Q' });
    expect(await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, ltToken: lt })).toMatchObject({ origin: 'PROVIDER_LED', reasonCode: 'EXPLICIT_PROVIDER_CHANNEL' });
    const other = issueLinkToken(linkTokenKey()!, { orgRef: 'org_B', linkCode: '7K2M9X4Q' });
    expect(await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, ltToken: other })).toMatchObject({ origin: 'UNATTRIBUTED' });
    const forged = lt.slice(0, -3) + 'AAA';
    expect(await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, ltToken: forged })).toMatchObject({ origin: 'UNATTRIBUTED' });
    const expired = issueLinkToken(linkTokenKey()!, { orgRef: 'org_A', linkCode: 'x', now: Date.now() - 3 * 3600_000 });
    expect(await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, ltToken: expired })).toMatchObject({ origin: 'UNATTRIBUTED' });
  });

  it('written exactly once per booking and policy version: sequential and 12 concurrent calls give one row, one event, one answer', async () => {
    await seedTouch(c, { kind: 'PROVIDER_QR', visitorKey: V, org: 'org_A', linkCode: 'QR123456' });
    const b = await seedBooking(c);
    const rs = await Promise.all(Array.from({ length: 12 }, () => svc.decideForBooking({ bookingId: b.id, visitorKey: V })));
    expect(new Set(rs.map((r) => r!.id)).size).toBe(1);
    expect(rs.filter((r) => r!.created).length).toBe(1);
    expect((await svc.decideForBooking({ bookingId: b.id, visitorKey: V }))!.created).toBe(false);
    expect(await c.prisma.growthAttributionDecision.count({ where: { bookingId: b.id } })).toBe(1);
    expect(await c.prisma.outboxEvent.count({ where: { type: 'AttributionAssigned' } })).toBe(1);
  });

  it('a later policy version never re-decides an old booking: the policy active AT booking time is the one cited; a newer booking cites the newer version', async () => {
    const old = await seedBooking(c, { createdAt: new Date(Date.now() - 2 * DAY) });
    const d1 = (await svc.decideForBooking({ bookingId: old.id }))!;
    const v2 = await activateConfig(c, 'ATTRIBUTION_POLICY', { ...(GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY as object), providerTouchWindowDays: 45 }, { effectiveFrom: new Date(Date.now() + 8 * DAY) });
    expect(v2.status).toBe('APPROVED');
    await c.get(GrowthConfigService).activateDue(new Date(Date.now() + 9 * DAY));
    expect((await svc.decideForBooking({ bookingId: old.id }))).toMatchObject({ id: d1.id, created: false, policyVersionId: d1.policyVersionId });
    expect(await c.prisma.growthAttributionDecision.count({ where: { bookingId: old.id } })).toBe(1);
    // a booking created after the new version's effective date cites it and uses its 45 day window
    const t = await seedTouch(c, { kind: 'PROVIDER_LINK', visitorKey: V, org: 'org_A', at: new Date(Date.now() + 9 * DAY - 40 * DAY), linkCode: 'WIN45DAY' });
    const late = await seedBooking(c, { createdAt: new Date(Date.now() + 9 * DAY) });
    const d2 = (await svc.decideForBooking({ bookingId: late.id, visitorKey: V }))!;
    expect(d2.policyVersionId).toBe(v2.id);
    expect(d2.origin).toBe('PROVIDER_LED');
    expect((await c.prisma.growthAttributionDecision.findUniqueOrThrow({ where: { id: d2.id } })).winningTouchId).toBe(t.id);
  });

  it('replay: the stored inputs reproduce the stored output (determinism SLI 100 %) for every decision; a correction is skipped', async () => {
    const ids: string[] = [];
    for (const k of ['PROVIDER_LINK', 'ORGANIC_SEARCH', 'REFERRAL', 'CAMPAIGN', 'DIRECT']) {
      const key = `kxv_${k.toLowerCase().padEnd(22, 'z')}`;
      await seedTouch(c, { kind: k, visitorKey: key, org: k === 'PROVIDER_LINK' ? 'org_A' : null, ageMs: DAY, linkCode: k === 'REFERRAL' || k === 'PROVIDER_LINK' ? 'CODE1234' : undefined });
      ids.push((await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, visitorKey: key }))!.id);
    }
    for (const id of ids) expect(await svc.replay(id)).toMatchObject({ matches: true, skipped: false });
    const rows = await c.prisma.growthAttributionDecision.findMany();
    expect(rows.every((r) => r.bookingSnapshot !== null && r.inputsHash.length === 64)).toBe(true);
  });

  it('p99 decision latency on seeded data (1 000 touches, 100 decisions) stays under 150 ms', async () => {
    const keys = Array.from({ length: 20 }, (_, i) => `kxv_perf${String(i).padStart(18, '0')}`);
    await c.prisma.growthAcquisitionSource.create({ data: { sourceKind: 'ORGANIC_SEARCH', sourceRef: 'perf' } });
    const src = await c.prisma.growthAcquisitionSource.findFirstOrThrow({ where: { sourceRef: 'perf' } });
    await c.prisma.growthTouchpoint.createMany({ data: Array.from({ length: 1000 }, (_, i) => ({ sourceId: src.id, kind: i % 7 === 0 ? 'PROVIDER_LINK' : 'ORGANIC_SEARCH', providerOrgRef: i % 7 === 0 ? 'org_A' : null, visitorKey: keys[i % 20]!, landingKind: 'HOME', dwellMs: 1500, occurredAt: new Date(Date.now() - (i % 25) * DAY - 3600_000) })) });
    await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, visitorKey: keys[0]! }); // warm: resolves and materialises the policy
    const ms: number[] = [];
    for (let i = 0; i < 100; i++) { const b = await seedBooking(c); const t0 = performance.now(); await svc.decideForBooking({ bookingId: b.id, visitorKey: keys[i % 20]! }); ms.push(performance.now() - t0); }
    ms.sort((a, b) => a - b);
    expect(ms[Math.floor(ms.length * 0.99) - 1]).toBeLessThan(150);
  });

  it('consent: touches before the person withdrew analytics consent are not used; touches after a fresh consent are', async () => {
    await seedTouch(c, { kind: 'PROVIDER_LINK', visitorKey: V, org: 'org_A', ageMs: 5 * DAY, linkCode: 'WITHDRAW1' });
    await c.prisma.consentRecord.create({ data: { sub: 'sub_amira', purpose: 'ANALYTICS_MEASUREMENT', granted: false, version: 'v', source: 'web', createdAt: new Date(Date.now() - 3 * DAY) } });
    expect(await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, visitorKey: V })).toMatchObject({ origin: 'UNATTRIBUTED' });
    await seedTouch(c, { kind: 'PROVIDER_LINK', visitorKey: V, org: 'org_A', ageMs: DAY, linkCode: 'WITHDRAW2' }); // a new session consented again
    expect(await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, visitorKey: V })).toMatchObject({ origin: 'PROVIDER_LED' });
  });

  it('market isolation: a touch recorded for another market is never used; and a booking of another subject does not borrow a stranger\'s visitor key without it being sent', async () => {
    await seedTouch(c, { kind: 'PROVIDER_LINK', visitorKey: V, org: 'org_A', market: 'AE', linkCode: 'AEONLY01' });
    expect(await svc.decideForBooking({ bookingId: (await seedBooking(c)).id, visitorKey: V })).toMatchObject({ origin: 'UNATTRIBUTED' });
    expect(await svc.decideForBooking({ bookingId: (await seedBooking(c)).id })).toMatchObject({ origin: 'UNATTRIBUTED' }); // no key presented
  });

  it('flag growth.attribution OFF: no decision, the booking stays UNATTRIBUTED (null), nothing is written', async () => {
    const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/admin/flags/growth.attribution/values').set(admin).send({ reason: 't', ticket: 'T-1', emergency: true, scope: 'GLOBAL', value: 'OFF' }).expect(200);
    const b = await seedBooking(c);
    expect(await svc.decideForBooking({ bookingId: b.id })).toBeNull();
    expect(await c.prisma.growthAttributionDecision.count()).toBe(0);
    expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } })).acquisitionOrigin).toBeNull();
  });

  describe('acquisition block for the Clinic', () => {
    it('validates against the contract schema and its evidenceHash is the stored inputs hash', async () => {
      await seedTouch(c, { kind: 'PROVIDER_LINK', visitorKey: V, org: 'org_A', ageMs: DAY, linkCode: '7K2M9X4Q' });
      const b = await seedBooking(c);
      const d = (await svc.decideForBooking({ bookingId: b.id, visitorKey: V }))!;
      const block = (await svc.acquisitionBlock(b.id))!;
      expect(validateAcquisitionBlock(block)).toEqual({ valid: true, value: block });
      expect(block).toMatchObject({ origin: 'PROVIDER_LED', decisionId: d.id, policyVersion: d.policyVersionId, reason: 'PRIOR_PROVIDER_TOUCH', evidenceHash: d.inputsHash, touch: { kind: 'PROVIDER_LINK', ref: '7K2M9X4Q' } });
      expect(await svc.acquisitionBlock('kx_bk_missing')).toBeNull();
    });
  });

  describe('overrides need authorisation and are audited; evidence can only remove a fee', () => {
    it('only a super admin may correct; the correction is a NEW row that supersedes, with actor and note; the old row stays; BookingIntent follows; audit and event written', async () => {
      const b = await seedBooking(c);
      const d = (await svc.decideForBooking({ bookingId: b.id }))!; // UNATTRIBUTED
      expect(await code(svc.correct({ sub: 'ops_1', roles: ['ops_admin'] }, b.id, { origin: 'PROVIDER_LED', note: 'printed card brought to desk' }))).toBe('FORBIDDEN_ROLE');
      expect(await code(svc.correct(SUPER_A, b.id, { origin: 'PROVIDER_LED', note: 'short' }))).toBe('NOTE_REQUIRED');
      expect(await code(svc.correct(SUPER_A, b.id, { origin: 'UNATTRIBUTED', note: 'same origin as before' }))).toBe('NO_CHANGE');
      const fix = await svc.correct(SUPER_A, b.id, { origin: 'PROVIDER_LED', note: 'printed card brought to the desk, verified with the clinic' });
      expect(fix).toMatchObject({ origin: 'PROVIDER_LED', reasonCode: 'MANUAL_CORRECTION' });
      const rows = await c.prisma.growthAttributionDecision.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: 'asc' } });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ id: d.id, origin: 'UNATTRIBUTED', supersedesId: null });
      expect(rows[1]).toMatchObject({ supersedesId: d.id, actor: 'adm_a', policyVersionId: d.policyVersionId });
      expect((await svc.latest(b.id))!.id).toBe(fix.id);
      expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: b.id } })).acquisitionOrigin).toBe('PROVIDER_LED');
      expect((await c.prisma.auditLog.findFirstOrThrow({ where: { action: 'growth.attribution.correct' } })).actor).toBe('adm_a');
      await expect(c.prisma.growthAttributionDecision.update({ where: { id: d.id }, data: { origin: 'MARKETPLACE' } })).rejects.toThrow(/append-only/);
    });
    it('a PROVIDER_LED decision can never be turned into a chargeable origin (403 CORRECTION_CANNOT_ADD_FEE); a decision can be corrected once per step', async () => {
      const b = await seedBooking(c, { channel: 'CLINIC_LINK' });
      await svc.decideForBooking({ bookingId: b.id });
      expect(await code(svc.correct(SUPER_A, b.id, { origin: 'MARKETPLACE', note: 'wanted to charge after all' }))).toBe('CORRECTION_CANNOT_ADD_FEE');
      const m = await seedBooking(c);
      await svc.decideForBooking({ bookingId: m.id });
      const rs = await Promise.allSettled([svc.correct(SUPER_A, m.id, { origin: 'PROVIDER_LED', note: 'first concurrent correction' }), svc.correct(SUPER_A, m.id, { origin: 'MARKETPLACE', note: 'second concurrent correction' })]);
      expect(rs.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      expect(await c.prisma.growthAttributionDecision.count({ where: { bookingId: m.id } })).toBeLessThanOrEqual(3);
    });

    /** Concurrent corrections of one booking are serialised on the booking row and each is judged against the TRUE head, never a stale one. */
    const chain = async (bookingId: string) => {
      const rows = await c.prisma.growthAttributionDecision.findMany({ where: { bookingId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      const heads = rows.filter((r) => !rows.some((o) => o.supersedesId === r.id));
      expect(heads).toHaveLength(1); // one head, no fork
      expect(new Set(rows.map((r) => r.supersedesId).filter(Boolean)).size).toBe(rows.length - 1); // each row superseded at most once
      expect((await c.prisma.bookingIntent.findUniqueOrThrow({ where: { id: bookingId } })).attributionDecisionId).toBe(heads[0]!.id);
      // fees only ever disappear: once PROVIDER_LED, never a chargeable origin again
      const ordered: typeof rows = []; for (let r: (typeof rows)[number] | undefined = rows.find((x) => !x.supersedesId); r; r = rows.find((x) => x.supersedesId === r!.id)) ordered.push(r);
      expect(ordered).toHaveLength(rows.length);
      const firstLed = ordered.findIndex((r) => r.origin === 'PROVIDER_LED');
      if (firstLed >= 0) expect(ordered.slice(firstLed).every((r) => r.origin === 'PROVIDER_LED')).toBe(true);
      return { rows: ordered, head: heads[0]! };
    };

    it('concurrent corrections of one booking never fail with a spurious "corrected concurrently": each is judged against the real head (20 rounds)', async () => {
      for (let i = 0; i < 20; i++) {
        const m = await seedBooking(c);
        await svc.decideForBooking({ bookingId: m.id }); // UNATTRIBUTED
        const rs = await Promise.allSettled([
          svc.correct(SUPER_A, m.id, { origin: 'PROVIDER_LED', note: 'first concurrent correction' }),
          svc.correct(SUPER_A, m.id, { origin: 'MARKETPLACE', note: 'second concurrent correction' }),
          svc.correct(SUPER_A, m.id, { origin: 'UNATTRIBUTED', note: 'third concurrent correction' }),
        ]);
        const codes = rs.map((r) => (r.status === 'fulfilled' ? 'OK' : (r.reason as { getResponse(): { code: string } }).getResponse().code));
        expect(codes.filter((x) => x !== 'OK').every((x) => ['NO_CHANGE', 'CORRECTION_CANNOT_ADD_FEE'].includes(x))).toBe(true); // never GROWTH_CONFIG_TRANSITION_FORBIDDEN
        expect(codes).toContain('OK');
        const { rows } = await chain(m.id);
        expect(rows.length - 1).toBe(codes.filter((x) => x === 'OK').length); // one new row per accepted correction
        expect(await c.prisma.auditLog.count({ where: { action: 'growth.attribution.correct', resourceId: { in: rows.map((r) => r.id) } } })).toBe(rows.length - 1);
      }
    });

    it('eight identical concurrent corrections apply exactly once; the other seven are NO_CHANGE', async () => {
      const m = await seedBooking(c);
      await svc.decideForBooking({ bookingId: m.id });
      const rs = await Promise.allSettled(Array.from({ length: 8 }, () => svc.correct(SUPER_A, m.id, { origin: 'PROVIDER_LED', note: 'same correction sent eight times' })));
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rs.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.getResponse().code)).toEqual(Array(7).fill('NO_CHANGE'));
      expect((await chain(m.id)).rows).toHaveLength(2);
      expect(await c.prisma.outboxEvent.count({ where: { type: 'AttributionAssigned', aggregateId: m.id } })).toBe(2); // decision + one correction
    });
  });

  describe('GET /growth/v1/evidence/:bookingId', () => {
    const path = (id: string) => `/api/v1/growth/v1/evidence/${id}`;
    const partner = (id: string, org?: string, o: { secret?: string; key?: string; nonce?: string } = {}) => { const s = signKiorlyRequest({ clientKey: o.key ?? 'kx_dev_client', clientSecret: o.secret ?? 'kx_dev_webhook_secret', method: 'GET', path: path(id), nonce: o.nonce }); return { ...s.headers, ...(org ? { 'X-Kiorly-Org-Ref': org } : {}) }; };
    let bk: string;
    beforeEach(async () => {
      await seedTouch(c, { kind: 'PROVIDER_LINK', visitorKey: V, org: 'org_A', ageMs: DAY, linkCode: '7K2M9X4Q' });
      await seedTouch(c, { kind: 'ORGANIC_SEARCH', visitorKey: V, ageMs: 2 * DAY });
      bk = (await seedBooking(c)).id; await svc.decideForBooking({ bookingId: bk, visitorKey: V });
    });
    it('ops session reads facts: decision, policy version, ordered touches with the winning one; never visitor keys, ip hashes or the sub', async () => {
      const ops = await c.as('ops1', { roles: ['ops_admin'] });
      const r = await c.http().get(path(bk)).set(ops).expect(200);
      expect(r.body).toMatchObject({ bookingId: bk, decision: { origin: 'PROVIDER_LED', reason: 'PRIOR_PROVIDER_TOUCH', inputsHash: expect.stringMatching(/^[0-9a-f]{64}$/) } });
      expect(r.body.touches.map((t: any) => t.kind)).toEqual(['ORGANIC_SEARCH', 'PROVIDER_LINK']);
      expect(r.body.touches.filter((t: any) => t.winning)).toHaveLength(1);
      expect(JSON.stringify(r.body)).not.toMatch(/kxv_|sub_amira|ipHash|clickId|visitorKey/);
    });
    it('a patient (no ops role) is refused 403; no credentials 401; a bad token 401', async () => {
      await c.http().get(path(bk)).set(await c.as('sub_amira')).expect(403);
      await c.http().get(path(bk)).expect(401);
      await c.http().get(path(bk)).set({ Authorization: 'Bearer nope' }).expect(401);
    });
    it('signed partner: only its own organisation\'s bookings; another organisation, a missing org header, a bad signature, a wrong key and a replayed nonce are all refused', async () => {
      await c.http().get(path(bk)).set(partner(bk, 'org_A')).expect(200);
      await c.http().get(path(bk)).set(partner(bk, 'org_B')).expect(404); // exactly like a missing booking: no oracle
      await c.http().get(path('kx_bk_nope')).set(partner('kx_bk_nope', 'org_A')).expect(404);
      await c.http().get(path(bk)).set(partner(bk)).expect(401);
      await c.http().get(path(bk)).set(partner(bk, 'org_A', { secret: 'wrong' })).expect(401);
      await c.http().get(path(bk)).set(partner(bk, 'org_A', { key: 'someone_else' })).expect(401);
      const h = partner(bk, 'org_A', { nonce: 'replay-1' });
      await c.http().get(path(bk)).set(h).expect(200);
      await c.http().get(path(bk)).set(h).expect(401);
    });
    it('a booking with no decision answers 404 GROWTH_EVIDENCE_NOT_FOUND', async () => {
      const id = (await seedBooking(c)).id;
      const r = await c.http().get(path(id)).set(await c.as('ops1', { roles: ['ops_admin'] })).expect(404);
      expect(r.body.code).toBe('GROWTH_EVIDENCE_NOT_FOUND');
    });
  });
});
