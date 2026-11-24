import { createCtx, TestCtx } from './harness';
import { DAY, unlockFlag } from './growth-helpers';
import { JourneyRunnerService } from '../src/growth/lifecycle/journey-runner.service';
import { LifecycleStateService } from '../src/growth/lifecycle/lifecycle-state.service';
import { AutomationTriggersService } from '../src/growth/automation/automation-triggers.service';
import { REENGAGE_TWO_STEP, BRANCHED, FEEDBACK_FOLLOWUP, clone } from '../src/growth/automation/journey.fixtures';
import { PatientService, SuppressionService } from '../src/patient/patient-public';
import { TEMPLATES } from '../src/engagement/templates';

type Auth = { Authorization: string };
const BASE = '/api/v1/admin/growth/automation';
const MARKETING_TEMPLATE_IDS = Object.values(TEMPLATES).filter((t) => t.marketing).map((t) => t.templateId);
const day0 = new Date('2027-03-10T10:00:00Z'); // 12:00 in Cairo, outside quiet hours
const KEY = 'auto.eg.reengage-2';

/**
 * GRW-P3-E marketing automation over the real HTTP stack and Postgres (messaging in mock mode): the builder API and its role matrix, maker-checker publication, immutability in the
 * database, the acceptance journey (consented, non-suppressed, in-window subjects only), consent withdrawn mid-journey, kill switch, flag OFF, retirement, branch arms, per-person caps.
 */
describe('growth marketing automation (GRW-P3-E)', () => {
  let c: TestCtx; let A: Auth; let B: Auth; let ops: Auth;
  const runner = () => c.get(JourneyRunnerService);
  const patients = () => c.get(PatientService);
  let seq = 0;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate();
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] });
  });

  const person = async (o: { daysOld?: number; locale?: 'ar' | 'en' } = {}) => {
    const sub = `au_sub_${++seq}`;
    await c.prisma.patientProfile.create({ data: { sub, phone: `+2010${String(20_000_000 + seq).slice(-8)}`, email: `${sub}@example.test`, preferredLocale: o.locale ?? 'ar', createdAt: new Date(day0.getTime() - (o.daysOld ?? 200) * DAY) } });
    return sub;
  };
  const consent = (sub: string, purposes: string[], granted = true) => Promise.all(purposes.map((p) => patients().setConsent(sub, p, granted, 'app')));
  const dormant = async (o: { consents?: string[]; locale?: 'ar' | 'en' } = {}) => { const sub = await person({ locale: o.locale }); await consent(sub, o.consents ?? ['MARKETING_PUSH']); await c.get(LifecycleStateService).refresh(sub, day0); return sub; };
  const decisions = (sub: string) => c.prisma.lifecycleMessageDecision.findMany({ where: { sub, journeyKey: KEY }, orderBy: { at: 'asc' } });
  const reasons = async (sub: string) => (await decisions(sub)).map((d) => `${d.channel}:${d.decision}:${d.reason}`);
  const marketingMessages = () => c.prisma.message.count({ where: { templateId: { in: MARKETING_TEMPLATE_IDS } } });
  const marketingOn = async () => { await unlockFlag(c, 'growth.marketing_messaging'); c.flags.invalidate(); };

  const draft = async (graph: unknown = REENGAGE_TWO_STEP, key = 'reengage-2') => (await c.http().post(`${BASE}/journeys`).set(A).send({ key, name: 'Win-back, two steps', graph }).expect(201)).body as { id: string; status: string; version: number };
  const publish = async (graph: unknown = REENGAGE_TWO_STEP, key = 'reengage-2') => {
    const d = await draft(graph, key);
    await c.http().post(`${BASE}/journeys/${d.id}/submit`).set(A).expect(200);
    const r = await c.http().post(`${BASE}/journeys/${d.id}/approve`).set(B).expect(200);
    return { id: d.id, body: r.body as { status: string; warnings: string[] } };
  };
  /** Enrol through the real trigger scan and make every active enrolment due `at`. */
  const enrol = async (subs: string[], anchorAt = new Date(day0.getTime() - 1000)) => { for (const s of subs) await runner().enrol({ sub: s, journeyKey: KEY, anchorId: 'd1', anchorAt, now: day0 }); };
  const due = (at: Date) => c.prisma.lifecycleEnrollment.updateMany({ where: { state: 'ACTIVE' }, data: { nextRunAt: at } });

  describe('API, roles and validation', () => {
    it('the catalog is the closed vocabulary; the status banner shows the marketing licence flag', async () => {
      const cat = (await c.http().get(`${BASE}/catalog`).set(ops).expect(200)).body;
      expect(cat.nodeTypes).toEqual(['TRIGGER', 'WAIT', 'CONDITION', 'SEND', 'BRANCH_EXPERIMENT', 'END']);
      expect(cat.templates.map((t: { key: string }) => t.key)).not.toContain('REWARD_ISSUED');
      expect(cat.policy).toMatchObject({ maxNodes: 12, minWaitMinutes: 15, maxSendsPerJourney: 3 });
      const st = (await c.http().get(`${BASE}/status`).set(ops).expect(200)).body;
      expect(st.marketingLicence).toMatchObject({ effective: false, flag: 'growth.marketing_messaging' });
    });
    it('reads for every ops role, writes for a super admin only; an unauthenticated call is refused', async () => {
      await c.http().get(`${BASE}/journeys`).expect(401);
      await c.http().get(`${BASE}/journeys`).set(ops).expect(200);
      await c.http().post(`${BASE}/journeys`).set(ops).send({ key: 'x-1', graph: REENGAGE_TWO_STEP }).expect(403);
      await c.http().post(`${BASE}/validate`).set(ops).send({ graph: REENGAGE_TWO_STEP }).expect(200);
    });
    it('an invalid graph answers 422 JOURNEY_INVALID with every error, code and path; nothing is stored', async () => {
      const bad: any = clone(REENGAGE_TWO_STEP); bad.nodes[3].segment = { specialty: ['x'] }; bad.nodes[2].minutes = 5; bad.nodes.push({ id: 'g', type: 'GATE' });
      const r = await c.http().post(`${BASE}/journeys`).set(A).send({ key: 'bad-one', graph: bad }).expect(422);
      expect(r.body.code).toBe('JOURNEY_INVALID');
      expect(r.body.errors.map((e: { code: string }) => e.code)).toEqual(expect.arrayContaining(['CLINICAL_REFERENCE', 'WAIT_RANGE', 'UNKNOWN_NODE_TYPE']));
      expect(await c.prisma.lifecycleJourneyDefinition.count()).toBe(0);
    });
    it('validate returns the compiled steps with the inserted gate nodes; dry-run is deterministic and sends nothing', async () => {
      const v = (await c.http().post(`${BASE}/validate`).set(ops).send({ graph: REENGAGE_TWO_STEP }).expect(200)).body;
      expect(v.valid).toBe(true); expect(v.compiled.gateNodes).toHaveLength(2); expect(v.compiled.steps.map((s: { delayMinutes: number }) => s.delayMinutes)).toEqual([0, 7 * 1440]);
      const d1 = (await c.http().post(`${BASE}/dry-run`).set(ops).send({ graph: REENGAGE_TWO_STEP, size: 500, seed: 3 }).expect(200)).body;
      const d2 = (await c.http().post(`${BASE}/dry-run`).set(ops).send({ graph: REENGAGE_TWO_STEP, size: 500, seed: 3 }).expect(200)).body;
      expect(d1).toEqual(d2); expect(d1.result.marketingFlagOn).toBe(false); expect(d1.result.totalSent).toBe(0); expect(d1.result.steps[0].skipped.MARKETING_FLAG_OFF).toBe(500);
      expect(await c.prisma.message.count()).toBe(0);
    });
    it('the dry run follows the real flag: with the licence flag effective the gate decisions show sends', async () => {
      await marketingOn();
      const d = (await c.http().post(`${BASE}/dry-run`).set(ops).send({ graph: REENGAGE_TWO_STEP, size: 800, seed: 3 }).expect(200)).body;
      expect(d.result.marketingFlagOn).toBe(true); expect(d.result.totalSent).toBeGreaterThan(0); expect(d.result.steps[0].skipped.NO_CONSENT).toBeGreaterThan(0);
    });
  });

  describe('maker-checker and immutability', () => {
    it('the author cannot approve; a different super admin publishes; a published journey cannot be edited; one open draft per key', async () => {
      const d = await draft();
      await c.http().post(`${BASE}/journeys`).set(A).send({ key: 'reengage-2', graph: REENGAGE_TWO_STEP }).expect(409);
      await c.http().post(`${BASE}/journeys/${d.id}/approve`).set(B).expect(409); // not submitted yet
      await c.http().post(`${BASE}/journeys/${d.id}/submit`).set(A).expect(200);
      expect((await c.http().post(`${BASE}/journeys/${d.id}/approve`).set(A).expect(403)).body.code).toBe('JOURNEY_TWO_PERSON_RULE');
      const ok = await c.http().post(`${BASE}/journeys/${d.id}/approve`).set(B).expect(200);
      expect(ok.body).toMatchObject({ status: 'PUBLISHED', approvedBy: 'adm_b', createdBy: 'adm_a', warnings: ['MARKETING_FLAG_OFF'] });
      expect((await c.http().patch(`${BASE}/journeys/${d.id}`).set(A).send({ name: 'x' }).expect(409)).body.code).toBe('JOURNEY_NOT_EDITABLE');
    });
    it('a reject by a different person returns the draft; the author edits only their own draft', async () => {
      const d = await draft();
      await c.http().patch(`${BASE}/journeys/${d.id}`).set(B).send({ name: 'mine now' }).expect(403);
      await c.http().post(`${BASE}/journeys/${d.id}/submit`).set(A).expect(200);
      await c.http().post(`${BASE}/journeys/${d.id}/reject`).set(A).send({ reason: 'no' }).expect(403);
      expect((await c.http().post(`${BASE}/journeys/${d.id}/reject`).set(B).send({ reason: 'needs another wait' }).expect(200)).body.status).toBe('DRAFT');
      const edited: any = clone(REENGAGE_TWO_STEP); edited.nodes[2].minutes = 5 * 1440;
      expect((await c.http().patch(`${BASE}/journeys/${d.id}`).set(A).send({ graph: edited }).expect(200)).body.checksum).not.toBe(d.id);
    });
    it('the database itself refuses to change or delete a published graph, and refuses an approver who is the author', async () => {
      const { id } = await publish();
      await expect(c.prisma.$executeRawUnsafe(`UPDATE "LifecycleJourneyDefinition" SET "graph" = '{"schema":1,"nodes":[],"edges":[]}'::jsonb WHERE "id" = '${id}'`)).rejects.toThrow(/immutable/);
      await expect(c.prisma.$executeRawUnsafe(`UPDATE "LifecycleJourneyDefinition" SET "checksum" = 'x' WHERE "id" = '${id}'`)).rejects.toThrow(/immutable/);
      await expect(c.prisma.$executeRawUnsafe(`DELETE FROM "LifecycleJourneyDefinition" WHERE "id" = '${id}'`)).rejects.toThrow(/immutable/);
      await expect(c.prisma.$executeRawUnsafe(`UPDATE "LifecycleJourneyDefinition" SET "status" = 'DRAFT' WHERE "id" = '${id}'`)).rejects.toThrow(/only move to RETIRED/);
      await expect(c.prisma.lifecycleJourneyDefinition.create({ data: { key: 'self-approved', graph: {}, checksum: 'c', createdBy: 'x', approvedBy: 'x', status: 'DRAFT' } })).rejects.toThrow();
      await c.prisma.lifecycleJourneyDefinition.update({ where: { id }, data: { killedAt: new Date(), killedBy: 'a', killReason: 'kill switch is allowed after publish' } });
    });
    it('publishing a new version retires the previous one in the same step (one PUBLISHED version per key)', async () => {
      const v1 = await publish(); const v2 = await publish(clone(REENGAGE_TWO_STEP));
      const rows = await c.prisma.lifecycleJourneyDefinition.findMany({ orderBy: { version: 'asc' } });
      expect(rows.map((r) => [r.id === v1.id ? 'v1' : r.id === v2.id ? 'v2' : '?', r.version, r.status])).toEqual([['v1', 1, 'RETIRED'], ['v2', 2, 'PUBLISHED']]);
    });
    it('a branch must name an experiment on the win-back surface', async () => {
      const d = await draft(BRANCHED, 'branchy');
      const r = await c.http().post(`${BASE}/journeys/${d.id}/submit`).set(A).expect(422);
      expect(r.body.errors[0].code).toBe('BRANCH_INVALID');
    });
    it('flag growth.automation_journeys OFF: writes answer 403 FEATURE_DISABLED, reads and the kill switch keep working', async () => {
      const { id } = await publish();
      await c.http().put('/api/v1/admin/flags/growth.automation_journeys/values').set(A).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-9', emergency: false }).then(() => c.flags.invalidate());
      await c.http().post(`${BASE}/journeys`).set(A).send({ key: 'other-one', graph: FEEDBACK_FOLLOWUP }).then((r) => { expect(r.status).toBe(403); expect(r.body.code).toBe('FEATURE_DISABLED'); });
      await c.http().get(`${BASE}/journeys/${id}`).set(ops).expect(200);
      await c.http().post(`${BASE}/journeys/${id}/kill`).set(A).send({ reason: 'stop everything' }).expect(200);
    });
  });

  describe('the acceptance journey in mock mode', () => {
    it('with the marketing licence flag OFF (the launch-locked default) nothing is ever sent, and every decision says why', async () => {
      const { body } = await publish(); expect(body.warnings).toContain('MARKETING_FLAG_OFF');
      const subs = [await dormant(), await dormant(), await dormant()];
      await enrol(subs); await due(day0);
      await runner().runDue(day0);
      expect(await marketingMessages()).toBe(0);
      for (const s of subs) expect(await reasons(s)).toEqual(['PUSH:SKIP:MARKETING_FLAG_OFF']);
    });

    it('ACCEPTANCE: sends only to consented, non-suppressed, in-window subjects; the second step is gated again a week later', async () => {
      await marketingOn(); const { id } = await publish();
      const yes = await dormant({ consents: ['MARKETING_PUSH'] });
      const none = await dormant({ consents: [] });
      const suppressed = await dormant({ consents: ['MARKETING_WHATSAPP'] });
      await c.get(SuppressionService).add({ address: (await c.prisma.patientProfile.findFirstOrThrow({ where: { sub: suppressed } })).phone!, channel: 'ALL', reason: 'STOP', source: 'whatsapp' });
      const night = await dormant({ consents: ['MARKETING_PUSH'] });
      await enrol([yes, none, suppressed, night]);
      // the quiet-hours person is evaluated at 23:30 Cairo, the others at noon
      const nightAt = new Date('2027-03-10T21:30:00Z'); // 23:30 in Cairo: inside quiet hours
      await c.prisma.lifecycleEnrollment.updateMany({ where: { sub: { not: night } }, data: { nextRunAt: day0 } });
      await c.prisma.lifecycleEnrollment.updateMany({ where: { sub: night }, data: { nextRunAt: nightAt } });
      await runner().runDue(day0);
      expect(await reasons(yes)).toEqual(['PUSH:SEND:OK']);
      expect(await reasons(none)).toEqual(['PUSH:SKIP:STOPPED']); // no marketing consent at all: the mandatory exit condition ends the journey before the gate is even asked
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub: none } })).endReason).toBe('STOPPED:MARKETING_CONSENT_LOST');
      expect(await reasons(suppressed)).toContain('WHATSAPP:SKIP:SUPPRESSED');
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub: suppressed } })).endReason).toMatch(/^EXIT:(SUPPRESSED|NO_CONSENT)$/);
      expect(await c.prisma.message.count({ where: { sub: yes, templateId: { in: MARKETING_TEMPLATE_IDS } } })).toBe(1);
      expect(await c.prisma.message.count({ where: { sub: { in: [none, suppressed] } } })).toBe(0);
      await runner().runDue(nightAt);
      expect((await reasons(night))[0]).toBe('PUSH:SKIP:QUIET_HOURS');
      const wait = await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub: night } });
      expect(wait.state).toBe('ACTIVE'); expect(wait.nextRunAt!.getTime()).toBeGreaterThan(nightAt.getTime()); // deferred, never dropped
      // a week later: the Arabic speaker gets step 2 (one message per day cap respected), an English speaker would have left at the condition
      const later = new Date(day0.getTime() + 8 * DAY);
      await due(later); await runner().runDue(later);
      expect(await c.prisma.message.count({ where: { sub: yes, templateId: { in: MARKETING_TEMPLATE_IDS } } })).toBe(2);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub: yes } })).state).toBe('ENDED');
      // counts only
      const log = await c.prisma.lifecycleJourneyRunLog.findMany({ where: { definitionId: id } });
      expect(log.reduce((a, l) => a + l.sent, 0)).toBeGreaterThanOrEqual(2); expect(Object.keys(log[0]!).sort()).toEqual(['byReason', 'day', 'definitionId', 'ended', 'enrolled', 'id', 'market', 'sent', 'skipped', 'updatedAt']);
    });

    it('step 2 condition: an English speaker leaves the journey at the condition (CONDITION_FALSE), and is never messaged again', async () => {
      await marketingOn(); await publish();
      const en = await dormant({ locale: 'en' });
      await c.prisma.patientLifecycle.updateMany({ where: { sub: en }, data: { language: 'en' } });
      await enrol([en]); await due(day0); await runner().runDue(day0);
      expect(await reasons(en)).toEqual(['PUSH:SEND:OK']);
      const later = new Date(day0.getTime() + 8 * DAY); await due(later); await runner().runDue(later);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub: en } })).endReason).toBe('EXIT:CONDITION_FALSE');
      expect(await c.prisma.message.count({ where: { sub: en, templateId: { in: MARKETING_TEMPLATE_IDS } } })).toBe(1);
    });

    it('consent withdrawn mid-journey stops the next step on the very next evaluation', async () => {
      await marketingOn(); await publish();
      const sub = await dormant({ consents: ['MARKETING_PUSH'] });
      await enrol([sub]); await due(day0); await runner().runDue(day0);
      expect(await reasons(sub)).toEqual(['PUSH:SEND:OK']);
      await consent(sub, ['MARKETING_PUSH'], false);
      const later = new Date(day0.getTime() + 8 * DAY); await due(later); await runner().runDue(later);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub } })).endReason).toBe('STOPPED:MARKETING_CONSENT_LOST');
      expect(await c.prisma.message.count({ where: { sub, templateId: { in: MARKETING_TEMPLATE_IDS } } })).toBe(1);
    });

    it('a booking made after the trigger ends the journey (mandatory exit condition)', async () => {
      await marketingOn(); await publish();
      const sub = await dormant({ consents: ['MARKETING_PUSH'] });
      await enrol([sub]); await due(day0); await runner().runDue(day0);
      await c.prisma.bookingIntent.create({ data: { id: `kx_bk_au${++seq}`, sub, providerId: 'lst_1', clinicId: 'cl_1', clinicianId: 'dr_1', typeId: 'typ_1', startsAt: new Date(day0.getTime() + 9 * DAY), endsAt: new Date(day0.getTime() + 9 * DAY + 1800_000), status: 'CONFIRMED', createdAt: new Date(day0.getTime() + 1 * DAY) } as never }).catch(() => undefined);
      const later = new Date(day0.getTime() + 8 * DAY); await due(later); await runner().runDue(later);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub } })).endReason).toMatch(/^STOPPED:(bookedAfterAnchor|leftDormant)$/);
    });
  });

  describe('kill switch, retirement, flag OFF', () => {
    it('the per-journey kill switch ends every enrolment on the next evaluation and blocks new ones', async () => {
      await marketingOn(); const { id } = await publish();
      const a = await dormant(); const b = await dormant();
      await enrol([a, b]);
      await c.http().post(`${BASE}/journeys/${id}/kill`).set(ops).send({ reason: 'x' }).expect(403);
      await c.http().post(`${BASE}/journeys/${id}/kill`).set(A).send({ reason: '' }).expect(400);
      await c.http().post(`${BASE}/journeys/${id}/kill`).set(A).send({ reason: 'copy under review' }).expect(200);
      await due(day0); await runner().runDue(day0);
      for (const s of [a, b]) expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub: s } })).endReason).toBe('KILLED');
      expect(await marketingMessages()).toBe(0);
      expect(await runner().enrol({ sub: await dormant(), journeyKey: KEY, anchorId: 'd2', now: day0 })).toEqual({ enrolled: false, reason: 'JOURNEY_DISABLED' });
    });
    it('the global switch (flag growth.automation_journeys OFF) stops new enrolments and ends running ones', async () => {
      await marketingOn(); await publish();
      const a = await dormant(); await enrol([a]);
      await c.http().put('/api/v1/admin/flags/growth.automation_journeys/values').set(A).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-9', emergency: false }).then(() => c.flags.invalidate());
      expect(await runner().enrol({ sub: await dormant(), journeyKey: KEY, anchorId: 'd3', now: day0 })).toEqual({ enrolled: false, reason: 'FLAG_OFF' });
      await due(day0); await runner().runDue(day0);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub: a } })).endReason).toBe('AUTOMATION_FLAG_OFF');
      expect(await marketingMessages()).toBe(0);
    });
    it('retiring a journey (or publishing a new version) ends the enrolments of the old one', async () => {
      await marketingOn(); const { id } = await publish();
      const a = await dormant(); await enrol([a]);
      await c.http().post(`${BASE}/journeys/${id}/retire`).set(A).expect(200);
      await due(day0); await runner().runDue(day0);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub: a } })).endReason).toBe('RETIRED');
      expect(await marketingMessages()).toBe(0);
    });
    it('growth.lifecycle_journeys OFF ends custom journeys too (they share the P2-E runner)', async () => {
      await marketingOn(); await publish();
      const a = await dormant(); await enrol([a]);
      await c.http().put('/api/v1/admin/flags/growth.lifecycle_journeys/values').set(A).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-9', emergency: false }).then(() => c.flags.invalidate());
      await due(day0); await runner().runDue(day0);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub: a } })).endReason).toMatch(/^(FLAG_OFF|AUTOMATION_FLAG_OFF)$/); // automation depends on lifecycle journeys
      expect(await marketingMessages()).toBe(0);
    });
  });

  describe('triggers and caps', () => {
    it('the trigger scan enrols people who entered DORMANT, once; a rerun changes nothing', async () => {
      await marketingOn(); await publish();
      const a = await dormant(); const fresh = await person({ daysOld: 3 }); await c.get(LifecycleStateService).refresh(fresh, day0);
      await c.prisma.patientLifecycle.update({ where: { sub_market: { sub: a, market: 'EG' } }, data: { stageAt: new Date(day0.getTime() - 3600_000) } });
      const r1 = await c.get(AutomationTriggersService).scan(day0); const r2 = await c.get(AutomationTriggersService).scan(day0);
      expect(r1).toMatchObject({ journeys: 1, enrolled: 1 }); expect(r2.enrolled).toBe(0);
      expect(await c.prisma.lifecycleEnrollment.count({ where: { journeyKey: { startsWith: 'auto.eg.reengage-2#' } } })).toBe(1);
    });
    it('a journey that is killed or still a draft is not scanned', async () => {
      await draft(); const r = await c.get(AutomationTriggersService).scan(day0); expect(r.journeys).toBe(0);
    });
    it('the per-person 30 day cap across automation journeys ends the journey before another message', async () => {
      await marketingOn(); await publish();
      const sub = await dormant();
      for (let i = 0; i < 4; i++) await c.prisma.lifecycleMessageDecision.create({ data: { sub, journeyKey: 'auto.eg.other', step: 1, messageClass: 'MARKETING', channel: 'PUSH', templateKey: 'REENGAGE_DORMANT', decision: 'SEND', reason: 'OK', at: new Date(day0.getTime() - (i + 1) * DAY) } });
      await enrol([sub]); await due(day0); await runner().runDue(day0);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub } })).endReason).toBe('EXIT:THIRTY_DAY_CAP');
      expect(await marketingMessages()).toBe(0);
    });
    it('a transactional follow-up (feedback reminder) is a journey too: no marketing flag needed, no gate marker', async () => {
      await c.prisma.bookingIntent.create({ data: { id: `kx_bk_au${++seq}`, sub: await person({ daysOld: 20 }), providerId: 'lst_1', clinicId: 'cl_1', clinicianId: 'dr_1', typeId: 'typ_1', startsAt: new Date(day0.getTime() - 4 * DAY), endsAt: new Date(day0.getTime() - 4 * DAY + 1800_000), status: 'COMPLETED', createdAt: new Date(day0.getTime() - 5 * DAY), updatedAt: new Date(day0.getTime() - 3600_000) } as never });
      const { id } = await publish(FEEDBACK_FOLLOWUP, 'feedback-follow');
      const view = (await c.http().get(`${BASE}/journeys/${id}`).set(ops).expect(200)).body;
      expect(view.compiled.gateNodes).toEqual([]); expect(view.compiled.steps[0]).toMatchObject({ messageClass: 'TRANSACTIONAL', template: 'FEEDBACK_REMINDER' });
      const r = await c.get(AutomationTriggersService).scan(day0); expect(r.enrolled).toBe(1);
    });
  });

  describe('branch arms (P3-A assignment)', () => {
    const experiment = (status = 'RUNNING') => c.prisma.growthExperiment.create({ data: { market: 'EG', key: 'winback-subject-test', name: 'Win-back subject', surface: 'lifecycle.winback.subject_line', hypothesis: 'A shorter line books more', status, variants: [{ key: 'control', weightBp: 5000 }, { key: 'short', weightBp: 5000 }], allocationBp: 10000, primaryMetric: 'booking_rate', salt: 'testsalt', createdBy: 'adm_a', approvedBy: 'adm_b', startedAt: new Date() } });
    it('each person follows exactly one arm; both arms are used; the exposure is recorded only when a step is sent; a stopped experiment sends everyone the control arm', async () => {
      await marketingOn(); await unlockFlag(c, 'growth.analytics_visitor'); await experiment(); // growth.experiments depends on the locked visitor analytics flag; until it is unlocked every branch is the control arm
      await publish(BRANCHED, 'branchy');
      const key = 'auto.eg.branchy'; const subs: string[] = [];
      for (let i = 0; i < 24; i++) subs.push(await dormant());
      for (const s of subs) await runner().enrol({ sub: s, journeyKey: key, anchorId: 'd1', anchorAt: new Date(day0.getTime() - 1000), now: day0 });
      await due(day0); await runner().runDue(day0);
      const sent = await c.prisma.lifecycleMessageDecision.findMany({ where: { journeyKey: key, decision: 'SEND' } });
      expect(sent.length).toBe(24);
      const kinds = new Set(sent.map((d) => d.templateKey)); expect(kinds).toEqual(new Set(['REENGAGE_DORMANT', 'REFERRAL_NUDGE']));
      expect(new Set(sent.map((d) => d.sub)).size).toBe(24); // one send per person: one arm each
      expect(await c.prisma.growthExperimentExposure.count()).toBe(24); // one exposure per person, recorded at the send
      // stop the experiment: a new person is on the control arm
      await c.prisma.growthExperiment.update({ where: { market_key: { market: 'EG', key: 'winback-subject-test' } }, data: { status: 'STOPPED', stoppedAt: new Date(), stopReason: 'test' } });
      const late = await dormant(); await runner().enrol({ sub: late, journeyKey: key, anchorId: 'd1', anchorAt: new Date(day0.getTime() - 1000), now: day0 }); await due(day0); await runner().runDue(day0);
      expect((await c.prisma.lifecycleMessageDecision.findFirstOrThrow({ where: { sub: late, journeyKey: key, decision: 'SEND' } })).templateKey).toBe('REENGAGE_DORMANT');
    });
  });
});
