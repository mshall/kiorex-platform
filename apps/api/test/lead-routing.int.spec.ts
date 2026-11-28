import { createCtx, TestCtx } from './harness';
import { resetLeadSubmissionLimits } from '../src/leads/leads.service';
import { LeadRoutingService } from '../src/leads/lead-routing.service';
import { DEFAULT_ROUTING_CONFIG } from '../src/leads/lead-routing';

const PUB = '/api/v1/public/leads';
const ADM = '/api/v1/admin/leads';
const RT = `${ADM}/routing`;
let n = 0;
const key = () => `idem_rt_${Date.now().toString(36)}_${++n}_abcd`;
const phone = () => `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const body = (over: object = {}) => ({
  source: 'kiorly-site', env: 'test', mode: 'STANDALONE', providerType: 'CLINIC', legalName: `Routing Clinic ${n}`, contactName: 'Dr Secret Person', phone: phone(), email: `secret.${n}@clinic-rt.example.org`,
  governorate: 'CAIRO', city: 'Nasr City', specialties: ['PEDIATRICS'], modules: ['CLINIC'], goLive: 'WITHIN_1_MONTH', locale: 'en', note: 'private applicant note', answers: {}, consent: { accepted: true, textVersion: 'draft-2' }, ...over,
});
/** every hour of every day is a working hour: reminder tests do not depend on the weekday they run on */
const ALWAYS = { days: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24 };
const cfgOf = (o: { rr?: Partial<typeof DEFAULT_ROUTING_CONFIG.roundRobin>; rem?: Partial<typeof DEFAULT_ROUTING_CONFIG.reminders> } = {}) => ({
  roundRobin: { ...DEFAULT_ROUTING_CONFIG.roundRobin, ...o.rr }, reminders: { ...DEFAULT_ROUTING_CONFIG.reminders, ...o.rem }, workWeek: ALWAYS,
});

describe('join requests: round-robin owner and the reminder clock', () => {
  let c: TestCtx; let svc: LeadRoutingService;
  let a: { Authorization: string }; let b: { Authorization: string }; let k: { Authorization: string }; let sup: { Authorization: string }; let sup2: { Authorization: string };
  const setCfg = async (o: Parameters<typeof cfgOf>[0] = {}) => { const v = cfgOf(o); await c.prisma.leadSetting.upsert({ where: { key: 'routing' }, create: { key: 'routing', version: 1, value: v }, update: { value: v } }); svc.invalidate(); };
  const create = async (over: object = {}) => { const r = await c.http().post(PUB).set('Idempotency-Key', key()).send(body(over)).expect(201); return c.prisma.lead.findFirstOrThrow({ where: { ref: r.body.reference } }); };
  const lead = (id: string) => c.prisma.lead.findUniqueOrThrow({ where: { id } });
  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);
  const mails = (tpl: string, ref?: string) => c.prisma.messageLog.findMany({ where: { templateId: tpl, ...(ref ? { body: { contains: ref } } : {}) } });
  beforeAll(async () => {
    c = await createCtx(); svc = c.get(LeadRoutingService);
    a = await c.as('rr_a', { roles: ['ops_admin'] }); b = await c.as('rr_b', { roles: ['ops_admin'] }); k = await c.as('rr_k', { roles: ['kiorly_ops'] }); sup = await c.as('rr_sup', { roles: ['super_admin'] }); sup2 = await c.as('rr_sup2', { roles: ['super_admin'] });
    for (const who of [a, b, k]) await c.http().get(`${ADM}/summary`).set(who).expect(200); // signing in to the console registers the user as active staff
    await c.prisma.opsStaffContact.update({ where: { sub: 'rr_a' }, data: { name: 'Alia', email: 'alia@kiorex.local', leadAlerts: true, channels: ['EMAIL'] } });
    await c.prisma.opsStaffContact.upsert({ where: { sub: 'rr_sup' }, create: { sub: 'rr_sup', name: 'Super', email: 'super@kiorex.local', roles: ['super_admin'], leadAlerts: true, channels: ['EMAIL'] }, update: { email: 'super@kiorex.local', roles: ['super_admin'], leadAlerts: true, channels: ['EMAIL'] } });
  });
  afterAll(async () => { await c.prisma.lead.deleteMany({}); await c.prisma.leadSetting.deleteMany({ where: { key: 'routing' } }); await c.prisma.leadRoutingState.deleteMany({}); await c.prisma.opsStaffContact.deleteMany({}); await c.prisma.partnerEnrolment.deleteMany({}); await c.close(); });
  beforeEach(async () => { await resetLeadSubmissionLimits(); await c.prisma.lead.deleteMany({}); await c.prisma.leadRoutingState.deleteMany({}); await c.prisma.opsStaffContact.updateMany({ data: { lastSeenAt: new Date() } }); await setCfg(); });

  describe('round-robin', () => {
    it('hands new requests to the eligible console users in turn (Kiorex ops and Kiorly roles), writes the trail and the audit, shows who and how', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) ids.push((await create()).id);
      const got = (await Promise.all(ids.map((id) => lead(id)))).map((l) => l.ownerSub);
      const eligible = (await c.prisma.opsStaffContact.findMany({ where: { lastSeenAt: { gte: ago(1) } } })).map((s) => s.sub).sort(); // a, b, k, sup (registered by the calls above)
      expect(eligible).toEqual(['rr_a', 'rr_b', 'rr_k', 'rr_sup']);
      expect(got).toEqual([...eligible, ...eligible].slice(0, 6));
      const l0 = await lead(ids[0]!); expect(l0).toMatchObject({ assignedVia: 'ROUND_ROBIN', routingFlag: null });
      const ev = await c.prisma.leadEvent.findMany({ where: { leadId: ids[0]!, kind: 'ASSIGN' } }); expect(ev).toHaveLength(1); expect(ev[0]).toMatchObject({ actor: 'system:round-robin' });
      expect(await c.prisma.auditLog.count({ where: { action: 'lead.auto_assigned', resourceId: ids[0]! } })).toBe(1);
      expect((await c.prisma.leadRoutingState.findUniqueOrThrow({ where: { key: 'roundrobin' } })).assignedCount).toBe(6);
      const row = (await c.http().get(`${ADM}?q=${l0.ref}`).set(a).expect(200)).body.items[0]; expect(row).toMatchObject({ ownerSub: 'rr_a', assignedVia: 'ROUND_ROBIN', routingFlag: null });
    });

    it('is safe under concurrency: 12 simultaneous requests, 3 owners, 4 each, none twice in one turn', async () => {
      await setCfg({ rr: { eligibleSubs: ['rr_a', 'rr_b', 'rr_k'] } });
      process.env.LEADS_RATE_IP_PER_10MIN = '100'; process.env.LEADS_RATE_IP_PER_DAY = '100'; process.env.LEADS_RATE_PHONE_PER_DAY = '100'; process.env.LEADS_RATE_GLOBAL_PER_HOUR = '1000';
      const ids = await Promise.all(Array.from({ length: 12 }, async () => { const r = await c.http().post(PUB).set('Idempotency-Key', key()).send(body()); return r.body.reference as string; }));
      for (const k of ['LEADS_RATE_IP_PER_10MIN', 'LEADS_RATE_IP_PER_DAY', 'LEADS_RATE_PHONE_PER_DAY', 'LEADS_RATE_GLOBAL_PER_HOUR']) delete process.env[k];
      expect(ids.every(Boolean)).toBe(true);
      const rows = await c.prisma.lead.findMany({ where: { ref: { in: ids } } }); expect(rows).toHaveLength(12);
      const per: Record<string, number> = {}; for (const r of rows) per[r.ownerSub ?? 'none'] = (per[r.ownerSub ?? 'none'] ?? 0) + 1;
      expect(per).toEqual({ rr_a: 4, rr_b: 4, rr_k: 4 });
    });

    it('skips inactive users and users who are not on the eligible list; nobody eligible: unassigned with a visible flag, counted, and a human can still assign', async () => {
      await c.prisma.opsStaffContact.update({ where: { sub: 'rr_b' }, data: { lastSeenAt: ago(24 * 40) } }); // not seen for 40 days (limit 30)
      const owners = []; for (let i = 0; i < 3; i++) owners.push((await create()).id);
      const got = (await Promise.all(owners.map(lead))).map((l) => l.ownerSub); expect(got).not.toContain('rr_b'); expect(new Set(got).size).toBe(3);
      await setCfg({ rr: { eligibleSubs: ['rr_b'] } }); // the only listed user is inactive
      const none = await create(); expect(await lead(none.id)).toMatchObject({ ownerSub: null, routingFlag: 'NO_ELIGIBLE_OWNER', assignedVia: null });
      expect(await c.prisma.leadEvent.count({ where: { leadId: none.id, kind: 'ROUTING' } })).toBe(1);
      expect((await c.http().get(`${ADM}/summary`).set(a).expect(200)).body.reminders.noEligible).toBe(1);
      expect((await c.http().get(`${ADM}/${none.id}`).set(a).expect(200)).body.routingFlag).toBe('NO_ELIGIBLE_OWNER');
      const hum = await c.http().patch(`${ADM}/${none.id}`).set(a).send({ ownerSub: 'rr_a' }).expect(200); expect(hum.body).toMatchObject({ ownerSub: 'rr_a', assignedVia: 'HUMAN', routingFlag: null });
    });

    it('switched off: no owner, no flag; a test request is never routed; a request that already has an owner keeps it', async () => {
      await setCfg({ rr: { enabled: false } }); expect(await lead((await create()).id)).toMatchObject({ ownerSub: null, routingFlag: null });
      await setCfg(); const t = await create({ legalName: '[TEST] Routing Test' }); expect(await lead(t.id)).toMatchObject({ ownerSub: null, isTest: true });
      expect((await c.prisma.leadRoutingState.findUnique({ where: { key: 'roundrobin' } }))?.assignedCount ?? 0).toBe(0);
      const x = await create(); const before = await lead(x.id); expect(await svc.assignNew(x.id)).toEqual({ assigned: null, flagged: false }); expect((await lead(x.id)).ownerSub).toBe(before.ownerSub);
    });

    it('a failing routing step never fails the applicant: the request is stored', async () => {
      const orig = svc.assignNew.bind(svc); (svc as any).assignNew = async () => { throw new Error('boom'); };
      try { const r = await c.http().post(PUB).set('Idempotency-Key', key()).send(body()); expect(r.status).toBe(201); expect(await c.prisma.lead.count({ where: { ref: r.body.reference } })).toBe(1); } finally { (svc as any).assignNew = orig; }
    });

    it('settings: any ops user reads them (Kiorly roles too), only a super admin saves, versioned, audited, validated, no second approver', async () => {
      await c.prisma.leadSetting.deleteMany({ where: { key: 'routing' } }); svc.invalidate();
      const v = (await c.http().get(RT).set(a).expect(200)).body; expect(v).toMatchObject({ version: 0, isDefault: true, config: { roundRobin: { enabled: true }, reminders: { remindAfterWorkingHours: 4, escalateAfterWorkingHours: 8 } } });
      expect(v.candidates.map((x: any) => x.sub)).toEqual(expect.arrayContaining(['rr_a', 'rr_b', 'rr_k'])); expect(v.candidates.every((x: any) => typeof x.eligibleNow === 'boolean')).toBe(true);
      await c.http().get(RT).set(k).expect(200);
      const cfg = { ...DEFAULT_ROUTING_CONFIG, roundRobin: { enabled: true, eligibleSubs: ['rr_a', 'rr_b'], activeWithinDays: 14 } };
      await c.http().put(RT).set(a).send({ version: 0, config: cfg }).expect(403); await c.http().put(RT).set(k).send({ version: 0, config: cfg }).expect(403);
      await c.http().put(RT).set(sup).send({ config: cfg }).expect(400);
      expect((await c.http().put(RT).set(sup).send({ version: 0, config: { ...cfg, reminders: { ...cfg.reminders, escalateAfterWorkingHours: 1 } } }).expect(400)).body.code).toBe('INVALID_ROUTING_CONFIG');
      const saved = (await c.http().put(RT).set(sup).send({ version: 0, config: cfg }).expect(200)).body; expect(saved).toMatchObject({ version: 1, updatedBy: 'rr_sup', isDefault: false, config: { roundRobin: { eligibleSubs: ['rr_a', 'rr_b'], activeWithinDays: 14 } } });
      expect((await c.http().put(RT).set(sup2).send({ version: 0, config: cfg }).expect(409)).body.code).toBe('ROUTING_CONFIG_STALE');
      await c.http().put(RT).set(sup2).send({ version: 1, config: { ...cfg, roundRobin: { ...cfg.roundRobin, enabled: false } } }).expect(200);
      const audit = await c.prisma.auditLog.findMany({ where: { action: 'lead.routing_changed' }, orderBy: { createdAt: 'asc' } }); expect(audit.map((x) => x.actor)).toEqual(['rr_sup', 'rr_sup2']);
      expect(JSON.stringify(audit)).not.toContain('rr_a'); // the audit line carries counts and section names, not the user list
      expect(await lead((await create()).id)).toMatchObject({ ownerSub: null }); // the saved "off" is in force
    });
  });

  describe('reminders for untouched NEW requests', () => {
    const owned = async (sub = 'rr_a') => { const l = await create(); await c.prisma.lead.update({ where: { id: l.id }, data: { ownerSub: sub, ownerName: 'Alia', assignedVia: 'HUMAN' } }); return l; };
    beforeEach(async () => { await setCfg({ rr: { enabled: false } }); await c.prisma.messageLog.deleteMany({}); });

    it('before the first threshold nothing is sent; after 4 working hours the OWNER is reminded once; after 8 the SUPER ADMINS are told once; repeated sweeps never repeat', async () => {
      const l = await owned(); await c.prisma.lead.update({ where: { id: l.id }, data: { createdAt: ago(3) } });
      expect(await svc.sweep()).toEqual({ reminded: 0, escalated: 0 });
      await c.prisma.lead.update({ where: { id: l.id }, data: { createdAt: ago(5) } });
      expect(await svc.sweep()).toEqual({ reminded: 1, escalated: 0 }); expect(await svc.sweep()).toEqual({ reminded: 0, escalated: 0 });
      let r = await mails('TODO_NEEDS_HUMAN_site_lead_reminder', l.ref); expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ mode: 'mock', channel: 'EMAIL' });
      expect(String(r[0]!.body)).not.toMatch(/Secret|private applicant|\+2010|secret\./i);
      await c.prisma.lead.update({ where: { id: l.id }, data: { createdAt: ago(9) } });
      expect(await svc.sweep()).toEqual({ reminded: 0, escalated: 1 }); expect(await svc.sweep()).toEqual({ reminded: 0, escalated: 0 });
      const e = await mails('TODO_NEEDS_HUMAN_site_lead_escalation', l.ref); expect(e).toHaveLength(1);
      expect(await mails('TODO_NEEDS_HUMAN_site_lead_reminder', l.ref)).toHaveLength(1);
      const trail = (await c.prisma.leadEvent.findMany({ where: { leadId: l.id, kind: 'REMINDER' }, orderBy: { createdAt: 'asc' } })).map((x) => (x.data as any).level); expect(trail).toEqual(['REMIND', 'ESCALATE']);
    });

    it('two sweeps at the same moment (two instances) send each stage once', async () => {
      const l = await owned(); await c.prisma.lead.update({ where: { id: l.id }, data: { createdAt: ago(9) } });
      const res = await Promise.all([svc.sweep(), svc.sweep(), svc.sweep()]);
      expect(res.reduce((s, x) => s + x.reminded, 0)).toBe(1); expect(res.reduce((s, x) => s + x.escalated, 0)).toBe(1);
      expect(await mails('TODO_NEEDS_HUMAN_site_lead_reminder', l.ref)).toHaveLength(1); expect(await mails('TODO_NEEDS_HUMAN_site_lead_escalation', l.ref)).toHaveLength(1);
    });

    it('a human touch stops it: status change, note and owner change each stop (and restart the clock for a request that is still NEW)', async () => {
      const mk = async () => { const l = await owned(); await c.prisma.lead.update({ where: { id: l.id }, data: { createdAt: ago(9) } }); return l; };
      const s1 = await mk(); await c.http().patch(`${ADM}/${s1.id}`).set(a).send({ status: 'CONTACTED' }).expect(200);
      const s2 = await mk(); await c.http().post(`${ADM}/${s2.id}/notes`).set(a).send({ text: 'called, no answer' }).expect(200);
      const s3 = await mk(); await c.http().patch(`${ADM}/${s3.id}`).set(a).send({ ownerSub: 'rr_b' }).expect(200);
      const s4 = await mk(); // control: not touched
      const res = await svc.sweep(); expect(res).toEqual({ reminded: 1, escalated: 1 });
      expect(await mails('TODO_NEEDS_HUMAN_site_lead_reminder', s4.ref)).toHaveLength(1);
      for (const x of [s1, s2, s3]) { expect(await mails('TODO_NEEDS_HUMAN_site_lead_reminder', x.ref)).toHaveLength(0); expect((await lead(x.id)).lastTouchedAt).not.toBeNull(); }
      // after the touch the clock runs again from the touch for a request that is still NEW: not due yet
      expect((await c.http().get(`${ADM}?q=${s2.ref}`).set(a).expect(200)).body.items[0].sla.state).toBe('OK');
      // a tag change is not a touch
      await c.http().patch(`${ADM}/${s4.id}`).set(a).send({ addTags: ['vip'] }).expect(200); expect((await lead(s4.id)).escalatedAt).not.toBeNull();
    });

    it('a touch clears the stamps, so a request that sits again gets its reminders again (and only then)', async () => {
      const l = await owned(); await c.prisma.lead.update({ where: { id: l.id }, data: { createdAt: ago(10) } }); await svc.sweep();
      expect(await lead(l.id)).toMatchObject({ remindedAt: expect.any(Date), escalatedAt: expect.any(Date) });
      await c.http().post(`${ADM}/${l.id}/notes`).set(a).send({ text: 'will call tomorrow' }).expect(200); expect(await lead(l.id)).toMatchObject({ remindedAt: null, escalatedAt: null });
      expect(await svc.sweep()).toEqual({ reminded: 0, escalated: 0 });
      await c.prisma.lead.update({ where: { id: l.id }, data: { lastTouchedAt: ago(5) } }); expect(await svc.sweep()).toEqual({ reminded: 1, escalated: 0 });
    });

    it('an unassigned request is reminded to the super admins instead; a test request, a request that is not NEW and a switched-off setting send nothing', async () => {
      const u = await create(); await c.prisma.lead.update({ where: { id: u.id }, data: { createdAt: ago(5) } });
      const t = await create({ legalName: '[TEST] Reminder Test' }); await c.prisma.lead.update({ where: { id: t.id }, data: { createdAt: ago(20) } });
      const c2 = await owned(); await c.prisma.lead.update({ where: { id: c2.id }, data: { createdAt: ago(20), status: 'CONTACTED' } });
      expect(await svc.sweep()).toEqual({ reminded: 1, escalated: 0 });
      const m = await mails('TODO_NEEDS_HUMAN_site_lead_reminder', u.ref); expect(m).toHaveLength(1); expect(String(m[0]!.recipient ?? (m[0] as any).to ?? '')).toBeDefined();
      expect(await c.prisma.messageLog.count({ where: { body: { contains: t.ref } } })).toBe(0); expect(await c.prisma.messageLog.count({ where: { body: { contains: c2.ref }, templateId: { contains: 'reminder' } } })).toBe(0);
      await setCfg({ rr: { enabled: false }, rem: { enabled: false } }); await c.prisma.lead.update({ where: { id: u.id }, data: { remindedAt: null, escalatedAt: null, createdAt: ago(30) } });
      expect(await svc.sweep()).toEqual({ reminded: 0, escalated: 0 });
    });

    it('in the console: every row carries the SLA state and "untouched since"; the summary counts; the filter lists what is due; a stale lead is visible even when nobody could be e-mailed', async () => {
      await c.prisma.opsStaffContact.update({ where: { sub: 'rr_a' }, data: { leadAlerts: false } }); // nobody opted in: the in-app record still exists
      const fresh = await owned(); const due = await owned(); const late = await owned('rr_b');
      await c.prisma.lead.update({ where: { id: due.id }, data: { createdAt: ago(5) } }); await c.prisma.lead.update({ where: { id: late.id }, data: { createdAt: ago(9) } });
      const list = (await c.http().get(ADM).set(a).expect(200)).body.items; const st = (id: string) => list.find((x: any) => x.id === id).sla.state;
      expect([st(fresh.id), st(due.id), st(late.id)]).toEqual(['OK', 'REMIND', 'ESCALATED']);
      const row = list.find((x: any) => x.id === due.id); expect(new Date(row.sla.since).getTime()).toBeLessThan(Date.now() - 4 * 3_600_000); expect(row.sla.remindAt).toBeTruthy();
      const sum = (await c.http().get(`${ADM}/summary`).set(a).expect(200)).body.reminders; expect(sum).toMatchObject({ enabled: true, untouched: 3, remind: 1, escalated: 1, mineDue: 1 });
      expect((await c.http().get(`${ADM}/summary`).set(b).expect(200)).body.reminders.mineDue).toBe(1);
      expect((await c.http().get(`${ADM}?sla=due`).set(a).expect(200)).body.items.map((x: any) => x.id).sort()).toEqual([due.id, late.id].sort());
      expect((await c.http().get(`${ADM}?sla=escalated`).set(a).expect(200)).body.items.map((x: any) => x.id)).toEqual([late.id]);
      await c.http().get(`${ADM}?sla=bogus`).set(a).expect(400);
      await svc.sweep(); expect(await c.prisma.leadEvent.count({ where: { leadId: due.id, kind: 'REMINDER' } })).toBe(1); // trail has it although no e-mail left
      expect((await c.http().get(`${ADM}/${due.id}`).set(a).expect(200)).body.sla.state).toBe('REMIND');
      await c.prisma.opsStaffContact.update({ where: { sub: 'rr_a' }, data: { leadAlerts: true } });
    });
  });
});
