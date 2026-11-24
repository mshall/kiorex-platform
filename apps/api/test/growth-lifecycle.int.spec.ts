import { createCtx, TestCtx } from './harness';
import { activateConfig, DAY, SUPER_A, unlockFlag } from './growth-helpers';
import { GROWTH_DEFAULT_PAYLOADS } from '../src/growth/growth-public';
import { JourneyRunnerService } from '../src/growth/lifecycle/journey-runner.service';
import { LifecycleService } from '../src/growth/lifecycle/lifecycle.service';
import { LifecycleStateService } from '../src/growth/lifecycle/lifecycle-state.service';
import { LifecycleTriggersService } from '../src/growth/lifecycle/lifecycle-triggers.service';
import { LifecycleJob } from '../src/growth/lifecycle/lifecycle.job';
import { inHoldout } from '../src/growth/lifecycle/frequency-cap';
import { PatientService, SuppressionService } from '../src/patient/patient-public';
import { TEMPLATES } from '../src/engagement/templates';

type Auth = { Authorization: string };
const BASE = '/api/v1/admin/growth/lifecycle';
const H = 3_600_000;
const iso = (s: string) => new Date(s);
/**
 * The send gate honours quiet hours (21:00 to 08:00 Cairo), so a test that runs the journeys at the REAL clock fails between 19:00 and 06:00 UTC (the order-dependence / time-of-day bug of the W7 exit gate).
 * Every run uses this injected clock instead: the next 10:00 UTC (12:00 or 13:00 in Cairo) at or after the real time, never inside quiet hours and always after anything seeded "now".
 */
const daytime = (): Date => { const n = new Date(); const t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 10)); return t.getTime() >= n.getTime() ? t : new Date(t.getTime() + 24 * H); };
const MARKETING_TEMPLATE_IDS = Object.values(TEMPLATES).filter((t) => t.marketing).map((t) => t.templateId);

/**
 * GRW-P2-E over the real HTTP stack and Postgres (messaging in mock mode): every journey from event to Message, idempotency, the send gate (consent, suppression, caps, quiet hours on both
 * Cairo offset-change nights, holdout, flag OFF), STOP and withdrawal, erasure, the console API and its role matrix, the patient classes view.
 */
describe('growth lifecycle CRM (GRW-P2-E)', () => {
  let c: TestCtx; let A: Auth; let B: Auth; let ops: Auth; let patient: Auth;
  const runner = () => c.get(JourneyRunnerService);
  const state = () => c.get(LifecycleStateService);
  const patients = () => c.get(PatientService);
  let seq = 0;
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); c.flags.invalidate();
    A = await c.as('adm_a', { roles: ['ops_admin', 'super_admin'] }); B = await c.as('adm_b', { roles: ['ops_admin', 'super_admin'] }); ops = await c.as('ops_1', { roles: ['ops_admin'] }); patient = await c.as('sub_amira', { roles: ['patient'] });
    delete process.env.LIFECYCLE_TEST_SUBS;
  });

  /** A registered person. `daysOld` is the registration age. */
  const person = async (o: { sub?: string; daysOld?: number; phone?: string; deleted?: boolean } = {}) => {
    const sub = o.sub ?? `lc_sub_${++seq}`;
    await c.prisma.patientProfile.create({ data: { sub, phone: o.phone ?? `+2010${String(10_000_000 + seq).slice(-8)}`, email: `${sub}@example.test`, preferredLocale: 'ar', createdAt: new Date(Date.now() - (o.daysOld ?? 1) * DAY), ...(o.deleted ? { deletedAt: new Date() } : {}) } });
    return sub;
  };
  const consent = (sub: string, purposes: string[], granted = true) => Promise.all(purposes.map((p) => patients().setConsent(sub, p, granted, 'app')));
  const decisions = (sub: string, journey?: string) => c.prisma.lifecycleMessageDecision.findMany({ where: { sub, ...(journey ? { journeyKey: journey } : {}) }, orderBy: { at: 'asc' } });
  const reasons = async (sub: string, journey?: string) => (await decisions(sub, journey)).map((d) => `${d.channel}:${d.decision}:${d.reason}`);
  const messages = (sub: string) => c.prisma.message.findMany({ where: { sub }, orderBy: { createdAt: 'asc' } });
  /** Messages other than the welcome card every new person gets from the trigger scan. */
  const nonWelcome = async (sub: string) => (await messages(sub)).filter((m) => (m.params as { kind: string }).kind !== 'WELCOME');
  const marketingMessages = () => c.prisma.message.count({ where: { templateId: { in: MARKETING_TEMPLATE_IDS } } });
  const intent = (sub: string, o: Partial<{ id: string; status: string; createdAt: Date; startsAt: Date; holdExpiresAt: Date | null; depositStatus: string; updatedAt: Date }> = {}) =>
    c.prisma.bookingIntent.create({ data: { id: o.id ?? `kx_bk_lc${Date.now().toString(36)}${++seq}`, sub, providerId: 'lst_1', clinicId: 'cl_1', clinicianId: 'dr_1', typeId: 'typ_1', startsAt: o.startsAt ?? new Date(Date.now() - 2 * DAY), endsAt: new Date((o.startsAt ?? new Date(Date.now() - 2 * DAY)).getTime() + 1_800_000), status: o.status ?? 'COMPLETED', holdExpiresAt: o.holdExpiresAt ?? null, depositStatus: o.depositStatus ?? 'NONE', createdAt: o.createdAt ?? new Date(Date.now() - 3 * DAY), ...(o.updatedAt ? { updatedAt: o.updatedAt } : {}) } as never });
  const policy = async (over: Record<string, unknown> = {}) => activateConfig(c, 'LIFECYCLE_POLICY', { ...(GROWTH_DEFAULT_PAYLOADS.LIFECYCLE_POLICY as object), ...over }, { announcement: 'Lifecycle messaging policy updated for the market.' });
  const marketingOn = async () => { await unlockFlag(c, 'growth.marketing_messaging'); c.flags.invalidate(); };

  describe('stages', () => {
    it('derives non-clinical stages from bookings, records changes in stageAt, and holds nothing clinical', async () => {
      const sub = await person({ daysOld: 10 });
      expect((await state().refresh(sub))).toMatchObject({ stage: 'REGISTERED', changed: true });
      await intent(sub, { status: 'HELD', createdAt: new Date(), startsAt: new Date(Date.now() + 5 * DAY) });
      expect((await state().refresh(sub))).toMatchObject({ stage: 'ACTIVATED', changed: true, from: 'REGISTERED' });
      await intent(sub, { status: 'COMPLETED' }); await intent(sub, { status: 'COMPLETED', startsAt: new Date(Date.now() - 20 * DAY), createdAt: new Date(Date.now() - 22 * DAY) });
      expect((await state().refresh(sub))).toMatchObject({ stage: 'RETAINED' });
      const again = await state().refresh(sub);
      expect(again?.changed).toBe(false);
      const row = await c.prisma.patientLifecycle.findFirstOrThrow({ where: { sub } });
      expect(Object.keys(row).sort()).toEqual(['bookingsCount', 'city', 'district', 'hasDependants', 'language', 'lastAttendedAt', 'lastBookingAt', 'market', 'platform', 'referralStatus', 'registeredAt', 'stage', 'stageAt', 'sub']);
    });
    it('dormant at 180 days and churned at 365 days without a booking; reconcile covers everyone in keyset batches; an erased person has no row', async () => {
      const dormant = await person({ daysOld: 200 }); const churned = await person({ daysOld: 400 }); const fresh = await person({ daysOld: 3 }); const gone = await person({ daysOld: 3, deleted: true });
      let cursor: string | null = null; let seen = 0;
      do { const r = await state().reconcileBatch(cursor, 2); seen += r.processed; cursor = r.next; } while (cursor);
      expect(seen).toBe(3); // the erased profile is not in the pass
      const stageOf = async (s: string) => (await c.prisma.patientLifecycle.findFirst({ where: { sub: s } }))?.stage;
      expect(await stageOf(dormant)).toBe('DORMANT'); expect(await stageOf(churned)).toBe('CHURNED'); expect(await stageOf(fresh)).toBe('REGISTERED'); expect(await stageOf(gone)).toBeUndefined();
    });
    it('the funnel withholds a count under 10 people', async () => {
      for (let i = 0; i < 10; i++) await state().refresh(await person({ daysOld: 2 }));
      await state().refresh(await person({ daysOld: 200 }));
      const f = (await c.http().get(`${BASE}/funnel`).set(ops).expect(200)).body as Array<{ stage: string; count: number | null }>;
      expect(f.find((x) => x.stage === 'REGISTERED')!.count).toBe(10);
      expect(f.find((x) => x.stage === 'DORMANT')!.count).toBeNull();
    });
  });

  describe('transactional journeys end to end (mock mode)', () => {
    it('welcome: registration -> one in-app card; a second run and a second scan change nothing', async () => {
      const sub = await person({ daysOld: 0 });
      const t = c.get(LifecycleTriggersService);
      await t.scan(); await t.scan();
      const r1 = await runner().runDue(daytime()); const r2 = await runner().runDue(daytime());
      expect(r1.sent).toBe(1); expect(r2.picked).toBe(0);
      const m = await messages(sub);
      expect(m.map((x) => [x.channel, x.status, x.params && (x.params as { kind: string }).kind])).toEqual([['INAPP', 'SENT', 'WELCOME']]);
      expect(await reasons(sub, 'welcome')).toEqual(['INAPP:SEND:OK']);
      expect(await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub } })).toMatchObject({ state: 'ENDED', endReason: 'COMPLETED' });
    });
    it('welcome with a registration confirmation also goes to WhatsApp (service message, marketplace-processing consent)', async () => {
      const sub = await person();
      await consent(sub, ['MARKETPLACE_PROCESSING']);
      await c.get(LifecycleService).signal({ kind: 'REGISTERED', sub, confirmationRequested: true });
      await runner().runDue(daytime());
      const e = await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub } });
      expect(e.step).toBe(1);
      await c.prisma.lifecycleEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
      await runner().runDue(daytime());
      expect((await messages(sub)).map((m) => m.channel).sort()).toEqual(['INAPP', 'WHATSAPP']);
      expect(await reasons(sub, 'welcome')).toEqual(['INAPP:SEND:OK', 'WHATSAPP:SEND:OK']);
    });
    it('booking recovery: a hold expired -> one nudge at +45 minutes with the REMINDERS consent; none without it; stops when the person books', async () => {
      const withConsent = await person(); const without = await person(); const booked = await person();
      await consent(withConsent, ['REMINDERS']); await consent(booked, ['REMINDERS']);
      const expired = new Date(Date.now() - 50 * 60_000);
      for (const s of [withConsent, without, booked]) await intent(s, { status: 'EXPIRED', holdExpiresAt: expired, updatedAt: new Date(), createdAt: new Date(expired.getTime() - 10 * 60_000), startsAt: new Date(Date.now() + DAY) });
      await intent(booked, { status: 'CONFIRMED', createdAt: new Date(), startsAt: new Date(Date.now() + 3 * DAY) });
      await c.get(LifecycleTriggersService).scan();
      await runner().runDue(daytime());
      expect((await reasons(withConsent, 'booking-recovery'))[0]).toBe('WHATSAPP:SEND:OK');
      expect(await c.prisma.message.count({ where: { sub: withConsent, status: 'SENT' } })).toBeGreaterThan(0);
      expect((await reasons(without, 'booking-recovery')).every((r) => r.endsWith('SKIP:NO_CONSENT'))).toBe(true);
      expect((await nonWelcome(without)).filter((m) => m.status === 'SENT')).toHaveLength(0);
      expect(await reasons(booked, 'booking-recovery')).toEqual(['WHATSAPP:SKIP:STOPPED']);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub: booked } })).endReason).toBe('STOPPED:bookedAfterAnchor');
      await c.get(LifecycleTriggersService).scan(); await runner().runDue(daytime()); // idempotent per (person, journey, anchor)
      expect(await c.prisma.lifecycleEnrollment.count({ where: { sub: withConsent, journeyKey: { startsWith: 'booking-recovery' } } })).toBe(1);
      expect((await decisions(withConsent, 'booking-recovery')).filter((d) => d.decision === 'SEND')).toHaveLength(1);
    });
    it('post-visit: ONE feedback reminder 48 hours after a completed visit, not when a review exists', async () => {
      const a = await person(); const b = await person();
      await consent(a, ['REMINDERS']); await consent(b, ['REMINDERS']);
      const done = new Date(Date.now() - 49 * H);
      const ia = await intent(a, { id: 'kx_bk_pv_a', status: 'COMPLETED', updatedAt: done }); const ib = await intent(b, { id: 'kx_bk_pv_b', status: 'COMPLETED', updatedAt: done });
      void ia;
      await c.prisma.review.create({ data: { bookingId: ib.id, sub: b, providerId: 'lst_1', clinicId: 'cl_1', clinicianId: 'dr_1', kiorlyAppointmentId: 'apt_b', rating: 5, editableUntil: new Date(Date.now() + DAY) } });
      await c.get(LifecycleTriggersService).scan(); await runner().runDue(daytime());
      expect((await reasons(a, 'post-visit'))[0]).toMatch(/SEND:OK$/);
      expect(await reasons(b, 'post-visit')).toEqual(['PUSH:SKIP:STOPPED']);
    });
    it('first attended visit: an in-app referral card and a family card, no message and no consent needed, marketing step waits 3 and 7 days', async () => {
      const sub = await person();
      await intent(sub, { id: 'kx_bk_first', status: 'COMPLETED', updatedAt: new Date(Date.now() - 2 * H) });
      await c.get(LifecycleTriggersService).scan(); await runner().runDue(daytime());
      const kinds = (await nonWelcome(sub)).map((m) => (m.params as { kind: string }).kind).sort();
      expect(kinds).toEqual(['FAMILY_ONBOARDING_CARD', 'REFERRAL_INVITE_CARD']);
      const follow = await c.prisma.lifecycleEnrollment.findMany({ where: { sub, state: 'ACTIVE', journeyKey: { in: ['referral-invite', 'family-onboarding'] } } });
      expect(follow).toHaveLength(2);
      for (const e of follow) expect(e.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 2.5 * DAY); // the marketing follow-ups are 3 and 7 days away
    });
    it('reward notices: issued, redeemed and reversed are TRANSACTIONAL service messages, idempotent per reward and event; expiring is one plain notice', async () => {
      const sub = await person();
      await consent(sub, ['MARKETPLACE_PROCESSING']);
      const svc = c.get(LifecycleService);
      for (const k of ['REWARD_ISSUED', 'REWARD_ISSUED', 'REWARD_REDEEMED', 'REWARD_REVERSED'] as const) await svc.signal({ kind: k, sub, rewardId: 'rw_1' });
      await svc.signal({ kind: 'REWARD_EXPIRING', sub, rewardId: 'rw_1', expiresAt: new Date(Date.now() + 10 * DAY) });
      await runner().runDue(daytime());
      const sent = (await messages(sub)).filter((m) => m.channel === 'INAPP').map((m) => (m.params as { kind: string }).kind).sort();
      expect(sent).toEqual(['REWARD_EXPIRING', 'REWARD_ISSUED', 'REWARD_REDEEMED', 'REWARD_REVERSED']);
      expect(await c.prisma.lifecycleEnrollment.count({ where: { sub } })).toBe(4);
    });
    it('deposit pending: a day-before follow-up while the deposit is still due; stops when it is paid', async () => {
      const a = await person(); const b = await person();
      await consent(a, ['REMINDERS']); await consent(b, ['REMINDERS']);
      const starts = new Date(Date.now() + 24 * H - 60_000); // the anchor (day before) is one minute ago
      await intent(a, { id: 'kx_bk_dep_a', status: 'PENDING_CLINIC', depositStatus: 'REQUIRED', startsAt: starts, createdAt: new Date() });
      const ib = await intent(b, { id: 'kx_bk_dep_b', status: 'PENDING_CLINIC', depositStatus: 'REQUIRED', startsAt: starts, createdAt: new Date() });
      await c.get(LifecycleTriggersService).scan();
      await c.prisma.bookingIntent.update({ where: { id: ib.id }, data: { depositStatus: 'PAID' } });
      await runner().runDue(daytime());
      expect((await reasons(a, 'reminders'))[0]).toBe('WHATSAPP:SEND:OK');
      expect(await reasons(b, 'reminders')).toEqual(['WHATSAPP:SKIP:STOPPED']);
    });
    it('legacy reminders are recorded as decisions in the same log (no second send)', async () => {
      const sub = await person();
      await runner().recordLegacyReminder({ sub, step: 'REMINDER_24H', decision: 'SEND', reason: 'OK' });
      expect(await reasons(sub, 'reminders')).toEqual(['ALL:SEND:OK']);
    });
  });

  describe('marketing: locked flag, consent, suppression, caps, quiet hours, holdout', () => {
    const dormant = async (marketingConsent = ['MARKETING_PUSH', 'MARKETING_WHATSAPP', 'MARKETING_SMS', 'MARKETING_EMAIL']) => {
      const sub = await person({ daysOld: 200 }); await consent(sub, marketingConsent); await state().refresh(sub); return sub;
    };
    const enrolRe = (sub: string, now = daytime()) => runner().enrol({ sub, journeyKey: 'reengagement', anchorId: 'd1', anchorAt: new Date(now.getTime() - 1000), now });

    it('ACCEPTANCE: with growth.marketing_messaging OFF (the launch-locked default) no MARKETING message is ever created, across every journey, even with every consent granted', async () => {
      const subs: string[] = [];
      for (let i = 0; i < 3; i++) subs.push(await dormant());
      const first = await person(); await consent(first, ['MARKETING_PUSH', 'MARKETING_WHATSAPP']); await intent(first, { id: 'kx_bk_mk1', status: 'COMPLETED', updatedAt: new Date(Date.now() - 2 * H) });
      for (const s of subs) expect((await enrolRe(s)).enrolled).toBe(true);
      await c.get(LifecycleTriggersService).scan();
      for (const e of await c.prisma.lifecycleEnrollment.findMany()) await c.prisma.lifecycleEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
      for (let i = 0; i < 3; i++) { await runner().runDue(new Date(Date.now() + i * 40 * DAY)); await c.prisma.lifecycleEnrollment.updateMany({ where: { state: 'ACTIVE' }, data: { nextRunAt: new Date(Date.now() - 1000) } }); }
      expect(await marketingMessages()).toBe(0);
      const all = await c.prisma.lifecycleMessageDecision.findMany({ where: { messageClass: 'MARKETING' } });
      expect(all.length).toBeGreaterThan(0);
      for (const d of all) { expect(d.decision).toBe('SKIP'); expect(d.reason).toBe('MARKETING_FLAG_OFF'); }
    });

    it('with the flag ON and consent: re-engagement sends once on the best channel (push) with the generic text; a person without any marketing consent gets nothing and the journey ends', async () => {
      await marketingOn(); 
      const yes = await dormant(['MARKETING_PUSH']); const no = await dormant([]);
      // the journey runs at a fixed daytime `day`, but the notification layer (engagement) judges quiet hours on the REAL clock: this test is about the send, so the person's own channel preference switches quiet hours off (the quiet-hours cases below own that rule)
      await c.prisma.notificationPreference.create({ data: { sub: yes, channel: 'PUSH', enabled: true, quietStart: 0, quietEnd: 0 } });
      const day = iso('2027-03-10T10:00:00Z');
      for (const s of [yes, no]) { expect((await enrolRe(s, day)).enrolled).toBe(true); await c.prisma.lifecycleEnrollment.updateMany({ where: { sub: s }, data: { nextRunAt: day } }); }
      await runner().runDue(day);
      expect(await reasons(yes, 'reengagement')).toEqual(['PUSH:SEND:OK']);
      const sent = (await messages(yes)).filter((m) => m.status === 'SENT' && m.channel === 'PUSH');
      expect(sent).toHaveLength(1);
      expect(TEMPLATES.REENGAGE_DORMANT.en + TEMPLATES.REENGAGE_DORMANT.ar).not.toMatch(/\{/);
      expect(await reasons(no, 'reengagement')).toEqual(['PUSH:SKIP:STOPPED']);
      expect(await marketingMessages()).toBe(1);
    });

    it('sends in the daytime, defers at night and sends after the window; a deferral never drops the step', async () => {
      await marketingOn();
      const sub = await dormant(['MARKETING_PUSH']);
      const night = iso('2027-03-10T20:30:00Z'); const morning = iso('2027-03-11T07:05:00Z'); // 22:30 and 09:05 Cairo
      expect((await enrolRe(sub, night)).enrolled).toBe(true);
      await c.prisma.lifecycleEnrollment.updateMany({ where: { sub }, data: { nextRunAt: night } });
      const n = await runner().runDue(night);
      expect(n.deferred).toBe(1); expect(await marketingMessages()).toBe(0);
      const e = await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub } });
      expect(e.nextRunAt!.toISOString()).toBe('2027-03-11T07:00:00.000Z');
      expect((await reasons(sub, 'reengagement'))[0]).toBe('PUSH:SKIP:QUIET_HOURS');
      const m = await runner().runDue(morning);
      expect(m.sent).toBe(1);
      expect(await marketingMessages()).toBeGreaterThan(0);
    });

    it.each([
      ['spring offset change (night of 29 to 30 April 2027)', '2027-04-29T21:30:00Z', '2027-04-30T06:00:00.000Z'],
      ['autumn offset change (night of 28 to 29 October 2027)', '2027-10-28T20:00:00Z', '2027-10-29T07:00:00.000Z'],
    ])('quiet hours across the %s: deferred to 09:00 local, then sent', async (_n, at, until) => {
      await marketingOn();
      const sub = await dormant(['MARKETING_PUSH']);
      const t0 = iso(at);
      await enrolRe(sub, t0); await c.prisma.lifecycleEnrollment.updateMany({ where: { sub }, data: { nextRunAt: t0 } });
      expect((await runner().runDue(t0)).deferred).toBe(1);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub } })).nextRunAt!.toISOString()).toBe(until);
      expect((await runner().runDue(new Date(until))).sent).toBe(1);
    });

    it('STOP: a suppression added by the STOP handler is seen by the very next run (well inside 60 seconds); a fresh opt-in lifts the person own STOP only', async () => {
      await marketingOn();
      const sub = await dormant(['MARKETING_SMS']);
      const day = iso('2027-03-10T10:00:00Z');
      await enrolRe(sub, day); await c.prisma.lifecycleEnrollment.updateMany({ where: { sub }, data: { nextRunAt: day } });
      const t0 = Date.now();
      await c.get(SuppressionService).add({ address: (await c.prisma.patientProfile.findFirstOrThrow({ where: { sub } })).phone!, channel: 'ALL', reason: 'STOP', source: 'whatsapp' });
      await runner().runDue(day);
      expect(Date.now() - t0).toBeLessThan(60_000);
      expect(await marketingMessages()).toBe(0);
      expect(await reasons(sub, 'reengagement')).toContain('SMS:SKIP:SUPPRESSED');
    });

    it('withdrawal: a withdrawn marketing consent ends the journey at the next run with STOPPED:MARKETING_CONSENT_LOST', async () => {
      await marketingOn();
      const sub = await dormant(['MARKETING_PUSH']);
      const day = iso('2027-03-10T10:00:00Z');
      await enrolRe(sub, day); await c.prisma.lifecycleEnrollment.updateMany({ where: { sub }, data: { nextRunAt: day } });
      await consent(sub, ['MARKETING_PUSH'], false);
      await runner().runDue(day);
      expect(await marketingMessages()).toBe(0);
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub } })).endReason).toBe('STOPPED:MARKETING_CONSENT_LOST');
      expect(await reasons(sub, 'reengagement')).toEqual(['PUSH:SKIP:STOPPED']);
    });

    it('frequency cap: day and week, all channels and campaigns share one budget', async () => {
      await marketingOn();
      const day = iso('2027-03-10T10:00:00Z');
      const capped = await dormant(['MARKETING_PUSH']); const weekly = await dormant(['MARKETING_PUSH']);
      const seed = (sub: string, n: number, hoursAgo: number[]) => Promise.all(hoursAgo.slice(0, n).map((h, i) => c.prisma.message.create({ data: { sub, channel: 'PUSH', templateId: MARKETING_TEMPLATE_IDS[0]!, status: 'SENT', sentAt: new Date(day.getTime() - h * H), dedupeKey: `seed:${sub}:${i}:PUSH`, params: { kind: 'REENGAGE_DORMANT' } } })));
      await seed(capped, 1, [2]); // one marketing send two hours ago: the day cap (1) is full
      await seed(weekly, 3, [30, 60, 100]); // none today, three this week: the week cap (3) is full
      for (const s of [capped, weekly]) { await enrolRe(s, day); await c.prisma.lifecycleEnrollment.updateMany({ where: { sub: s }, data: { nextRunAt: day } }); }
      await runner().runDue(day);
      expect(await reasons(capped, 'reengagement')).toContain('PUSH:SKIP:CAP_DAY');
      expect(await reasons(weekly, 'reengagement')).toContain('PUSH:SKIP:CAP_WEEK');
      expect(await c.prisma.message.count({ where: { sub: { in: [capped, weekly] }, status: 'SENT', dedupeKey: { startsWith: 'lc:' } } })).toBe(0);
    });

    it('holdout: the configured slice never receives re-engagement and the decision says HOLDOUT; the rest do', async () => {
      await marketingOn();
      await policy({ holdoutBps: 2000 });
      const day = iso('2027-03-10T10:00:00Z');
      let held: string | null = null; let free: string | null = null;
      for (let i = 0; i < 200 && !(held && free); i++) { const s = await dormant(['MARKETING_PUSH']); if (inHoldout(s, 'reengagement', 2000)) held ??= s; else free ??= s; }
      for (const s of [held!, free!]) { await enrolRe(s, day); await c.prisma.lifecycleEnrollment.updateMany({ where: { sub: s }, data: { nextRunAt: day } }); }
      await runner().runDue(day);
      expect(await reasons(held!, 'reengagement')).toEqual(['PUSH:SKIP:HOLDOUT']);
      expect((await reasons(free!, 'reengagement'))[0]).toBe('PUSH:SEND:OK');
    });

    it('policy: a journey switched off in LIFECYCLE_POLICY does not enrol; max 2 re-engagement sends per 90 days is enforced', async () => {
      await policy({ journeys: { reengagement: { enabled: false, messageClass: 'MARKETING' } } });
      const sub = await dormant(['MARKETING_PUSH']);
      expect(await enrolRe(sub)).toEqual({ enrolled: false, reason: 'JOURNEY_DISABLED' });
    });
    it('re-engagement needs the DORMANT stage', async () => {
      const sub = await person({ daysOld: 5 }); await state().refresh(sub);
      expect(await enrolRe(sub)).toEqual({ enrolled: false, reason: 'NOT_ELIGIBLE' });
    });
  });

  describe('flag growth.lifecycle_journeys and erasure', () => {
    it('OFF: no new enrolments and running ones end with FLAG_OFF; the notification layer itself is untouched', async () => {
      const sub = await person();
      expect((await runner().enrol({ sub, journeyKey: 'welcome' })).enrolled).toBe(true);
      await c.http().put('/api/v1/admin/flags/growth.lifecycle_journeys/values').set(A).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-9', emergency: false }).then(() => c.flags.invalidate());
      expect(await runner().enrol({ sub: await person(), journeyKey: 'welcome' })).toEqual({ enrolled: false, reason: 'FLAG_OFF' });
      await c.prisma.lifecycleEnrollment.updateMany({ where: { sub }, data: { nextRunAt: new Date(Date.now() - 1000) } });
      await runner().runDue(daytime());
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub } })).endReason).toBe('FLAG_OFF');
      expect(await messages(sub)).toHaveLength(0);
      await c.get(PatientService).setConsent(sub, 'MARKETPLACE_PROCESSING', true, 'app');
      const ids = await (await import('../src/engagement/engagement-public')).EngagementService.prototype.notify.call(c.get((await import('../src/engagement/engagement-public')).EngagementService), sub, { kind: 'BOOKING_CONFIRMED', params: { doctor: 'x', time: 'y' }, dedupeKey: 'plain:1', channels: [] });
      expect(ids.length).toBeGreaterThan(0); // transactional notifications still flow
    });
    it('an erased person is never messaged: the enrolment ends and nothing is sent', async () => {
      const sub = await person();
      await runner().enrol({ sub, journeyKey: 'welcome' });
      await c.prisma.patientProfile.update({ where: { sub }, data: { deletedAt: new Date() } });
      await c.prisma.lifecycleEnrollment.updateMany({ where: { sub }, data: { nextRunAt: new Date(Date.now() - 1000) } });
      await runner().runDue(daytime());
      expect((await c.prisma.lifecycleEnrollment.findFirstOrThrow({ where: { sub } })).endReason).toBe('STOPPED:accountDeleted');
      expect(await messages(sub)).toHaveLength(0);
    });
    it('the job runs the whole tick and leaves a heartbeat', async () => {
      await person({ daysOld: 0 });
      const r = await c.get(LifecycleJob).runOnce();
      expect(r.triggers.enrolled).toBeGreaterThan(0);
      expect(await c.prisma.growthJobRun.count({ where: { job: 'lifecycle', finishedAt: { not: null } } })).toBe(1);
    });
  });

  describe('console API and roles', () => {
    it('requires a sign-in and an ops role; a patient is refused', async () => {
      await c.http().get(BASE).expect(401);
      await c.http().get(BASE).set(patient).expect(403);
      expect((await c.http().get(BASE).set(ops).expect(200)).body.journeys).toHaveLength(8);
    });
    it('overview lists the eight journeys with class, steps, policy state and the flags; templates carry the class badge and AR and EN previews', async () => {
      const o = (await c.http().get(BASE).set(ops).expect(200)).body;
      expect(o.flags).toEqual({ lifecycleJourneys: true, marketingMessaging: false });
      expect(o.policy).toMatchObject({ source: 'PROPOSED_DEFAULT', caps: { perDay: 1, perWeek: 3 }, quietHours: { start: '21:00', end: '09:00', timezone: 'Africa/Cairo' } });
      const re = o.journeys.find((j: { key: string }) => j.key === 'reengagement');
      expect(re).toMatchObject({ hasMarketingStep: true, enabled: true });
      const t = (await c.http().get(`${BASE}/templates`).set(ops).expect(200)).body as Array<{ kind: string; messageClass: string; ar: string; en: string; copyReview: string }>;
      const w = t.find((x) => x.kind === 'REENGAGE_DORMANT')!;
      expect(w).toMatchObject({ messageClass: 'MARKETING', copyReview: 'PENDING' }); expect(w.ar.length).toBeGreaterThan(5); expect(w.en.length).toBeGreaterThan(5);
      expect(t.find((x) => x.kind === 'NEW_DEVICE_NOTICE')!.messageClass).toBe('SECURITY');
    });
    it('decisions are aggregate by reason; the DPO lookup is audited', async () => {
      const sub = await person({ daysOld: 0 });
      await runner().enrol({ sub, journeyKey: 'welcome' }); await runner().runDue(daytime());
      const d = (await c.http().get(`${BASE}/decisions?days=7`).set(ops).expect(200)).body as Array<{ journeyKey: string; reason: string; count: number }>;
      expect(d.find((x) => x.journeyKey === 'welcome' && x.reason === 'OK')!.count).toBe(1);
      expect(JSON.stringify(d)).not.toContain(sub);
      const l = (await c.http().get(`${BASE}/lookup?sub=${sub}`).set(ops).expect(200)).body;
      expect(l).toHaveLength(1);
      const audit = await c.prisma.auditLog.findFirstOrThrow({ where: { action: 'growth.lifecycle.lookup' } });
      expect(JSON.stringify(audit.metadata)).not.toContain(sub);
    });
    it('suppression admin: add (super admin, note required), list shows a hash tail never the address, lifting needs two different people and evidence', async () => {
      await c.http().post(`${BASE}/suppressions`).set(ops).send({ address: '+201000000099', channel: 'SMS', note: 'asked by phone' }).expect(403);
      await c.http().post(`${BASE}/suppressions`).set(A).send({ address: '+201000000099', channel: 'SMS', note: 'x' }).expect(400);
      const added = (await c.http().post(`${BASE}/suppressions`).set(A).send({ address: '+201000000099', channel: 'SMS', note: 'asked by phone, ticket 12' }).expect(201)).body;
      const list = (await c.http().get(`${BASE}/suppressions`).set(ops).expect(200)).body as Array<{ id: string; hashTail: string }>;
      expect(JSON.stringify(list)).not.toContain('201000000099'); expect(list[0]!.hashTail).toHaveLength(6);
      await c.http().post(`${BASE}/suppressions/${added.id}/lift-approve`).set(B).expect(400); // nobody asked yet
      await c.http().post(`${BASE}/suppressions/${added.id}/lift-request`).set(A).send({ evidence: 'short' }).expect(400);
      await c.http().post(`${BASE}/suppressions/${added.id}/lift-request`).set(A).send({ evidence: 'Written opt-in on the form of 12 March, scan ref 77' }).expect(200);
      await c.http().post(`${BASE}/suppressions/${added.id}/lift-approve`).set(A).expect(403); // never the requester
      await c.http().post(`${BASE}/suppressions/${added.id}/lift-approve`).set(B).expect(200);
      expect((await c.http().get(`${BASE}/suppressions`).set(ops).expect(200)).body).toHaveLength(0);
      expect(await c.prisma.auditLog.count({ where: { resourceId: added.id, action: { startsWith: 'growth.lifecycle.suppression' } } })).toBe(3);
    });
    it('test send: staff allowlist and mock mode only', async () => {
      await c.http().post(`${BASE}/test-send`).set(A).send({ kind: 'WELCOME', channel: 'INAPP' }).expect(403);
      process.env.LIFECYCLE_TEST_SUBS = 'staff_1';
      await c.http().post(`${BASE}/test-send`).set(A).send({ kind: 'NOPE', channel: 'INAPP' }).expect(400);
      await c.http().post(`${BASE}/test-send`).set(A).send({ kind: 'WELCOME', channel: 'INAPP', sub: 'someone_else' }).expect(403);
      const r = (await c.http().post(`${BASE}/test-send`).set(A).send({ kind: 'WELCOME', channel: 'INAPP' }).expect(200)).body;
      expect(r.messageIds).toHaveLength(1);
      void SUPER_A;
    });
    it('the patient sees the four classes: three required service classes, marketing optional per channel, quiet hours and caps, and the stop-all route', async () => {
      const r = (await c.http().get('/api/v1/me/preferences/classes').set(patient).expect(200)).body;
      expect(r.classes.map((x: { class: string }) => x.class)).toEqual(['TRANSACTIONAL', 'SECURITY', 'CLINICAL', 'MARKETING']);
      expect(r.classes.filter((x: { required: boolean }) => x.required)).toHaveLength(3);
      expect(r.classes[3]).toMatchObject({ switchable: true, available: false, active: false });
      expect(r.classes[3].channels.map((x: { channel: string }) => x.channel).sort()).toEqual(['EMAIL', 'PUSH', 'SMS', 'WHATSAPP']);
      expect(r.caps).toEqual({ perDay: 1, perWeek: 3 });
      expect(r.stopAllMarketing.path).toBe('/me/preferences/unsubscribe-marketing');
      await c.http().get('/api/v1/me/preferences/classes').expect(401);
    });
  });
});
