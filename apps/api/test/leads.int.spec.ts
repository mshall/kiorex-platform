import { createCtx, TestCtx } from './harness';
import { resetLeadSubmissionLimits } from '../src/leads/leads.service';

const PUB = '/api/v1/public/leads';
const ADM = '/api/v1/admin/leads';
let n = 0;
const key = () => `idem_${Date.now().toString(36)}_${++n}_abcd`;
const phone = () => `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const body = (over: object = {}) => ({
  source: 'kiorly-site', env: 'test', mode: 'CONNECTED', providerType: 'CLINIC', legalName: 'Integration Clinic LLC', tradeName: 'Int Clinic', contactName: 'Dr Integration', contactRole: 'Owner', phone: phone(),
  email: 'owner@clinic-int.example.org', governorate: 'CAIRO', city: 'Nasr City', branches: 2, staffCount: 14, specialties: ['PEDIATRICS', 'DERMATOLOGY'], services: 'Walk-in and follow-up',
  currentSoftware: 'Paper', licences: { facilityLicence: 'FL-1234/2025', taxCard: '555-444-333' }, modules: ['CLINIC', 'STAFF_APP'], goLive: 'WITHIN_1_MONTH', locale: 'en', contactChannel: 'WHATSAPP', contactTime: 'EVENING',
  note: 'Please call after 5 pm', answers: { rooms: 6 }, consent: { accepted: true, textVersion: 'draft-2' }, ...over,
});

describe('Kiorly site join requests (leads)', () => {
  let c: TestCtx; let ops: { Authorization: string }; let sup: { Authorization: string }; let patient: { Authorization: string };
  const post = (b: object, k: string | null = key()) => { const r = c.http().post(PUB); if (k) r.set('Idempotency-Key', k); return r.send(b); };
  beforeAll(async () => { c = await createCtx(); ops = await c.as('ops_l', { roles: ['ops_admin'] }); sup = await c.as('sup_l', { roles: ['super_admin'] }); patient = await c.as('pat_l', { roles: ['patient'] }); });
  afterAll(async () => { await c.prisma.lead.deleteMany({}); await c.close(); }); // leave no rows behind: other suites count the shared tables
  beforeEach(async () => { await resetLeadSubmissionLimits(); for (const k of ['LEADS_RATE_IP_PER_10MIN', 'LEADS_RATE_IP_PER_DAY', 'LEADS_RATE_PHONE_PER_DAY', 'LEADS_RATE_INVALID_PER_10MIN', 'LEADS_RATE_GLOBAL_PER_HOUR']) delete process.env[k]; });

  it('serves the public form configuration (active picklists only, governorates, per-type fields) without credentials', async () => {
    const r = await c.http().get(`${PUB}/config`).expect(200);
    expect(r.headers['cache-control']).toContain('max-age=60');
    expect(r.body.providerTypes.map((t: any) => t.key)).toEqual(['CLINIC', 'INDEPENDENT_DOCTOR', 'CHAIN', 'HOSPITAL', 'NURSE', 'PHYSICIAN', 'LAB', 'PHARMACY', 'OTHER']);
    expect(r.body.markets).toHaveLength(1); expect(r.body.markets[0]).toMatchObject({ key: 'EG', dialCode: '+20' }); expect(r.body.markets[0].governorates.length).toBe(27);
    expect(r.body.typeFields.CHAIN.minBranches).toBe(2); expect(r.body.typeFields.NURSE.answers.homeVisits).toEqual({ kind: 'bool' });
    expect(JSON.stringify(r.body)).not.toMatch(/phoneEnc|secret|password/i);
  });

  it('stores a full request: 201 with a reference; contact data, licences and the note are encrypted at rest; business fields are plain', async () => {
    const b = body({ email: 'enc-check@clinic-int.example.org' });
    const r = await post(b).expect(201);
    expect(r.body).toMatchObject({ status: 'RECEIVED', replayed: false }); expect(r.body.reference).toMatch(/^KL-[A-Z2-9]{8}$/);
    const row = await c.prisma.lead.findFirstOrThrow({ where: { ref: r.body.reference } });
    expect(row).toMatchObject({ status: 'NEW', mode: 'CONNECTED', providerType: 'CLINIC', legalName: 'Integration Clinic LLC', market: 'EG', governorate: 'CAIRO', branches: 2, isTest: false });
    const dump = JSON.stringify(row);
    for (const secret of [b.phone, 'enc-check@clinic-int.example.org', 'Dr Integration', 'FL-1234/2025', '555-444-333', 'Please call after 5 pm']) expect(dump).not.toContain(secret);
    expect(row.phoneEnc.startsWith('v1.')).toBe(true); expect(row.licencesEnc?.startsWith('v1.')).toBe(true); expect(row.phoneHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.extra).toEqual({ rooms: 6 });
    const ev = await c.prisma.leadEvent.findMany({ where: { leadId: row.id } }); expect(ev.some((e) => e.kind === 'CREATED')).toBe(true);
    expect(JSON.stringify(ev)).not.toContain(b.phone);
  });

  it('idempotency: same key and body = same reference (replayed); same key, different body = 409; missing or malformed key = 400', async () => {
    const k = key(); const b = body();
    const a = await post(b, k).expect(201); const again = await post(b, k).expect(201);
    expect(again.body).toMatchObject({ reference: a.body.reference, replayed: true });
    expect(await c.prisma.lead.count({ where: { idempotencyKey: k } })).toBe(1);
    expect((await post({ ...b, legalName: 'Different Name' }, k).expect(409)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await post(body(), null).expect(400)).body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    await post(body(), 'short').expect(400);
    const [p1, p2] = await Promise.all([post(body({ phone: '+201099990001' }), 'race_key_12345678'), post(body({ phone: '+201099990001' }), 'race_key_12345678')]);
    expect([p1.status, p2.status].every((s) => s === 201)).toBe(true); expect(p1.body.reference).toBe(p2.body.reference);
    expect(await c.prisma.lead.count({ where: { idempotencyKey: 'race_key_12345678' } })).toBe(1);
  });

  it('strict validation: 400 VALIDATION_FAILED with per-field codes, nothing stored; unknown fields refused', async () => {
    const before = await c.prisma.lead.count();
    const r = await post({ ...body(), legalName: '', phone: 'abc', email: 'bad', providerType: 'X', consent: { accepted: false } }).expect(400);
    expect(r.body).toMatchObject({ code: 'VALIDATION_FAILED' }); expect(r.body.fields).toMatchObject({ legalName: 'required', phone: 'invalid', email: 'invalid', providerType: 'invalid', consent: 'required' });
    expect((await post({ ...body(), isAdmin: true }).expect(400)).body.fields).toEqual({ isAdmin: 'not_allowed' });
    expect((await post({ ...body(), providerType: 'CHAIN', branches: 1 }).expect(400)).body.fields.branches).toBe('too_short');
    expect((await post({ ...body(), phone: '0100 123 4567', providerType: 'INDEPENDENT_DOCTOR', licences: { professionalLicence: 'MD-9' }, answers: { practiceSetting: 'OWN_CLINIC' } }).expect(201)).body.reference).toBeTruthy();
    expect(await c.prisma.lead.count()).toBe(before + 1);
    await c.http().post(PUB).set('Idempotency-Key', key()).set('content-type', 'application/json').send('{bad json').expect(400);
  });

  it('oversize body is 413 before parsing; the honeypot answers like a success and stores nothing', async () => {
    const big = await post({ ...body(), note: 'x'.repeat(20_000) });
    expect(big.status).toBe(413); expect(big.body.code).toBe('PAYLOAD_TOO_LARGE');
    const before = await c.prisma.lead.count();
    const h = await post({ ...body(), website: 'http://bot.example' }).expect(201);
    expect(h.body.reference).toMatch(/^KL-/); expect(await c.prisma.lead.count()).toBe(before);
    expect(await c.prisma.lead.count({ where: { ref: h.body.reference } })).toBe(0);
  });

  it('rate limits: per IP in 10 minutes, per phone per day, with Retry-After; invalid input is limited separately', async () => {
    process.env.LEADS_RATE_IP_PER_10MIN = '3';
    for (let i = 0; i < 3; i++) await post(body()).expect(201);
    const r = await post(body()); expect(r.status).toBe(429); expect(r.body.code).toBe('RATE_LIMITED'); expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    await resetLeadSubmissionLimits(); delete process.env.LEADS_RATE_IP_PER_10MIN;
    process.env.LEADS_RATE_PHONE_PER_DAY = '2'; const ph = '+201055550000';
    await post(body({ phone: ph })).expect(201); await post(body({ phone: ph })).expect(201); expect((await post(body({ phone: ph }))).status).toBe(429);
    await resetLeadSubmissionLimits(); delete process.env.LEADS_RATE_PHONE_PER_DAY; process.env.LEADS_RATE_INVALID_PER_10MIN = '2';
    await post({ ...body(), phone: 'x' }).expect(400); await post({ ...body(), phone: 'x' }).expect(400); expect((await post({ ...body(), phone: 'x' })).status).toBe(429);
  });

  it('duplicates are detected by phone or e-mail (keyed hash), linked to the first request, flagged on both, and still stored', async () => {
    const ph = phone(); const first = (await post(body({ phone: ph, email: 'dup-first@clinic-int.example.org' })).expect(201)).body.reference;
    const second = (await post(body({ phone: ph, email: 'other@clinic-int.example.org', legalName: 'Same Phone Clinic' })).expect(201)).body.reference;
    const third = (await post(body({ phone: phone(), email: 'dup-first@clinic-int.example.org', legalName: 'Same Mail Clinic' })).expect(201)).body.reference;
    const rows = await c.prisma.lead.findMany({ where: { ref: { in: [first, second, third] } } }); const f = rows.find((r) => r.ref === first)!;
    expect(f.duplicateOfId).toBeNull();
    for (const ref of [second, third]) { const r = rows.find((x) => x.ref === ref)!; expect(r.duplicateOfId).toBe(f.id); expect(r.tags).toContain('duplicate'); }
    const d = (await c.http().get(`${ADM}/${f.id}`).set(ops).expect(200)).body;
    expect(d.duplicates.map((x: any) => x.ref).sort()).toEqual([second, third].sort()); expect(d.events.filter((e: any) => e.kind === 'DUPLICATE')).toHaveLength(2);
    const only = (await c.http().get(`${ADM}?duplicates=only&q=${first}`).set(ops).expect(200)).body; expect(only.items.length).toBe(0);
  });

  it('test data tagging: reserved e-mail domain or name prefix tags the lead as test; counts exclude it; super admin removes it (dry run first); ops cannot', async () => {
    const t1 = (await post(body({ email: 'e2e@example.test', legalName: 'Tagged By Mail' })).expect(201)).body.reference;
    const t2 = (await post(body({ email: undefined, legalName: '[TEST] Tagged By Name' })).expect(201)).body.reference;
    const rows = await c.prisma.lead.findMany({ where: { ref: { in: [t1, t2] } } });
    expect(rows.every((r) => r.isTest && r.tags.includes('test'))).toBe(true);
    const only = (await c.http().get(`${ADM}?test=only`).set(ops).expect(200)).body; expect(only.items.map((x: any) => x.ref)).toEqual(expect.arrayContaining([t1, t2]));
    expect((await c.http().get(`${ADM}?test=exclude`).set(ops).expect(200)).body.items.some((x: any) => [t1, t2].includes(x.ref))).toBe(false);
    await c.http().post(`${ADM}/test/remove`).set(ops).send({ confirm: true }).expect(403);
    const dry = (await c.http().post(`${ADM}/test/remove`).set(sup).send({}).expect(200)).body; expect(dry).toMatchObject({ dryRun: true }); expect(dry.count).toBeGreaterThanOrEqual(2);
    const done = (await c.http().post(`${ADM}/test/remove`).set(sup).send({ confirm: true }).expect(200)).body; expect(done).toMatchObject({ dryRun: false, count: dry.count });
    expect(await c.prisma.lead.count({ where: { isTest: true } })).toBe(0);
    expect(await c.prisma.leadEvent.count({ where: { leadId: { in: rows.map((r) => r.id) } } })).toBe(0); // the trail goes with the lead
  });

  it('admin access: no token 401, a patient 403, ops and super admin 200 on the same list', async () => {
    await c.http().get(ADM).expect(401); await c.http().get(ADM).set(patient).expect(403); await c.http().get(`${ADM}/summary`).set(patient).expect(403);
    await c.http().get(ADM).set(ops).expect(200); await c.http().get(ADM).set(sup).expect(200);
    await c.http().get(`${ADM}/export.csv`).set(patient).expect(403);
  });

  it('inbox filters: status, type, mode, market, date range, text, phone and e-mail search, owner; pagination', async () => {
    const ph = phone(); const ref = (await post(body({ phone: ph, mode: 'STANDALONE', providerType: 'LAB', legalName: 'Filter Lab Unique Name', email: 'filter-lab@clinic-int.example.org', specialties: [], answers: { homeSampling: true } })).expect(201)).body.reference;
    const get = async (qs: string) => (await c.http().get(`${ADM}?${qs}`).set(ops).expect(200)).body;
    expect((await get(`type=LAB&mode=STANDALONE&q=Unique`)).items.map((x: any) => x.ref)).toContain(ref);
    expect((await get(`type=CLINIC&q=Unique`)).total).toBe(0);
    expect((await get(`q=${ref}`)).items[0].ref).toBe(ref);
    expect((await get(`q=${encodeURIComponent(ph)}`)).items.map((x: any) => x.ref)).toContain(ref);
    expect((await get(`q=${encodeURIComponent(ph.replace('+20', '0'))}`)).items.map((x: any) => x.ref)).toContain(ref);
    expect((await get(`q=filter-lab@clinic-int.example.org`)).items.map((x: any) => x.ref)).toContain(ref);
    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`from=${today}&to=${today}&q=Unique`)).total).toBe(1); expect((await get(`from=2020-01-01&to=2020-01-02&q=Unique`)).total).toBe(0);
    expect((await get(`market=EG&status=NEW&q=Unique`)).total).toBe(1); expect((await get(`market=SA&q=Unique`)).total).toBe(0);
    expect((await get(`pageSize=1`)).items).toHaveLength(1); expect((await get(`pageSize=1`)).total).toBeGreaterThan(1);
    expect((await get('owner=none&q=Unique')).total).toBe(1);
    await c.http().get(`${ADM}?status=BOGUS`).set(ops).expect(400); await c.http().get(`${ADM}?from=yesterday`).set(ops).expect(400);
    const item = (await get(`q=${ref}`)).items[0]; expect(item.phoneMasked).not.toContain(ph.slice(4, 9)); expect(item).not.toHaveProperty('phone'); expect(item.contactName).toBe('Dr Integration');
  });

  it('detail decrypts for ops and is audited; lifecycle follows the allowed transitions; lost needs a known reason; notes and owner are recorded in the trail', async () => {
    const ref = (await post(body({ phone: '+201066660001', legalName: 'Lifecycle Clinic' })).expect(201)).body.reference;
    const id = (await c.prisma.lead.findFirstOrThrow({ where: { ref } })).id;
    const d = (await c.http().get(`${ADM}/${id}`).set(ops).expect(200)).body;
    expect(d).toMatchObject({ phone: '+201066660001', email: 'owner@clinic-int.example.org', contactName: 'Dr Integration', note: 'Please call after 5 pm', licences: { facilityLicence: 'FL-1234/2025', taxCard: '555-444-333' }, status: 'NEW' });
    expect(d.allowedTransitions).toEqual(['CONTACTED', 'QUALIFIED', 'LOST']);
    expect(await c.prisma.auditLog.count({ where: { action: 'lead.viewed', resourceId: id, actor: 'ops_l' } })).toBeGreaterThan(0);
    await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: 'WON' }).expect(409);
    await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: 'NOPE' }).expect(400);
    await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: 'CONTACTED' }).expect(200);
    await c.http().patch(`${ADM}/${id}`).set(ops).send({ ownerSub: 'sup_l' }).expect(400); // not a known team member yet
    await c.http().get(`${ADM}/owners`).set(sup).expect(200); const owners = (await c.http().get(`${ADM}/owners`).set(ops).expect(200)).body; expect(owners.map((o: any) => o.sub)).toEqual(expect.arrayContaining(['ops_l', 'sup_l']));
    const asg = (await c.http().patch(`${ADM}/${id}`).set(ops).send({ ownerSub: 'sup_l' }).expect(200)).body; expect(asg).toMatchObject({ ownerSub: 'sup_l', ownerName: 'Amira Samy' });
    await c.http().post(`${ADM}/${id}/notes`).set(ops).send({ text: 'Called, wants a demo on Sunday' }).expect(200);
    await c.http().post(`${ADM}/${id}/notes`).set(ops).send({ text: '   ' }).expect(400);
    await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: 'QUALIFIED' }).expect(200);
    await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: 'ONBOARDING' }).expect(200);
    await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: 'LOST', lostReason: 'NOT_REAL_REASON' }).expect(400);
    const lost = (await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: 'LOST', lostReason: 'LATER' }).expect(200)).body;
    expect(lost).toMatchObject({ status: 'LOST', lostReason: 'LATER', allowedTransitions: ['NEW'] });
    const kinds = lost.events.map((e: any) => e.kind); expect(kinds).toEqual(expect.arrayContaining(['CREATED', 'STATUS', 'ASSIGN', 'NOTE']));
    expect(lost.events.find((e: any) => e.kind === 'NOTE')).toMatchObject({ actor: 'ops_l', data: { text: 'Called, wants a demo on Sunday' } });
    expect(lost.events.filter((e: any) => e.kind === 'STATUS').map((e: any) => `${e.data.from}>${e.data.to}`)).toEqual(['NEW>CONTACTED', 'CONTACTED>QUALIFIED', 'QUALIFIED>ONBOARDING', 'ONBOARDING>LOST']);
    const reopened = (await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: 'NEW' }).expect(200)).body; expect(reopened).toMatchObject({ status: 'NEW', lostReason: null });
    const audit = await c.prisma.auditLog.findMany({ where: { resource: 'Lead', resourceId: id } }); expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['lead.updated', 'lead.note_added', 'lead.viewed']));
    expect(JSON.stringify(audit)).not.toContain('+201066660001'); // no contact data in the audit trail
    await c.http().patch(`${ADM}/${id}`).set(ops).send({ isTest: true }).expect(403); // only a super admin changes the test tag
    expect((await c.http().patch(`${ADM}/${id}`).set(sup).send({ isTest: true, addTags: ['Demo-Batch', 'bad tag!'] }).expect(200)).body.tags).toEqual(expect.arrayContaining(['test', 'demo-batch']));
    await c.http().patch(`${ADM}/${id}`).set(sup).send({ isTest: false, removeTags: ['demo-batch'] }).expect(200);
    await c.http().get(`${ADM}/ld_missing`).set(ops).expect(404);
  });

  it('the WON path: qualified, onboarding, won; a won request can only be reopened to onboarding', async () => {
    const id = (await c.prisma.lead.findFirstOrThrow({ where: { ref: (await post(body({ phone: '+201066660002' })).expect(201)).body.reference } })).id;
    for (const s of ['QUALIFIED', 'ONBOARDING', 'WON']) await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: s }).expect(200);
    await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: 'NEW' }).expect(409);
    await c.http().patch(`${ADM}/${id}`).set(ops).send({ status: 'ONBOARDING' }).expect(200);
  });

  it('CSV export: decrypted, filtered, formula-safe, audited, ops and super admin; counts in the summary', async () => {
    await post(body({ phone: '+201066660003', legalName: '=HYPERLINK("http://x")', email: 'csv@clinic-int.example.org' })).expect(201);
    const r = await c.http().get(`${ADM}/export.csv?q=HYPERLINK`).set(ops).expect(200);
    expect(r.headers['content-type']).toContain('text/csv'); expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.text.startsWith('\uFEFFreference,created_at')).toBe(true);
    expect(r.text).toContain("'=HYPERLINK"); expect(r.text).toContain('+201066660003'); expect(r.text).toContain('csv@clinic-int.example.org'); expect(r.text).toContain('FL-1234/2025');
    const a = await c.prisma.auditLog.findFirst({ where: { action: 'lead.exported' }, orderBy: { createdAt: 'desc' } }); expect(a?.actor).toBe('ops_l'); expect(JSON.stringify(a)).not.toContain('HYPERLINK');
    await c.http().get(`${ADM}/export.csv`).set(sup).expect(200);
    const s = (await c.http().get(`${ADM}/summary`).set(ops).expect(200)).body; expect(s.byStatus.NEW).toBeGreaterThan(0); expect(s).toHaveProperty('unassignedOpen');
  });

  it('settings: ops reads, only a super admin saves; a save changes the public form at once; stale version 409; invalid 400; audited without contents', async () => {
    const cur = (await c.http().get(`${ADM}/settings`).set(ops).expect(200)).body; expect(cur.version).toBe(0); expect(cur.isDefault).toBe(true);
    const next = JSON.parse(JSON.stringify(cur.config));
    next.providerTypes = next.providerTypes.map((t: any) => (t.key === 'OTHER' ? { ...t, active: false } : t));
    next.specialties.push({ key: 'SLEEP_MEDICINE', en: 'Sleep medicine', ar: 'طب النوم', active: true });
    next.requiredFields = ['modules', 'email', 'city'];
    await c.http().put(`${ADM}/settings`).set(ops).send({ version: 0, config: next }).expect(403);
    const saved = (await c.http().put(`${ADM}/settings`).set(sup).send({ version: 0, config: next }).expect(200)).body;
    expect(saved).toMatchObject({ version: 1, isDefault: false, updatedBy: 'sup_l' });
    const pub = (await c.http().get(`${PUB}/config`).expect(200)).body;
    expect(pub.providerTypes.map((t: any) => t.key)).not.toContain('OTHER'); expect(pub.specialties.map((s: any) => s.key)).toContain('SLEEP_MEDICINE'); expect(pub.requiredFields).toEqual(['modules', 'email', 'city']);
    expect((await post(body({ providerType: 'OTHER', answers: { otherDescription: 'x' } })).expect(400)).body.fields.providerType).toBe('invalid');
    expect((await post(body({ email: undefined })).expect(400)).body.fields.email).toBe('required');
    await post(body({ specialties: ['SLEEP_MEDICINE'] })).expect(201);
    expect((await c.http().put(`${ADM}/settings`).set(sup).send({ version: 0, config: next }).expect(409)).body.code).toBe('LEAD_CONFIG_STALE');
    const bad = JSON.parse(JSON.stringify(next)); bad.markets[0].dialCode = 'x'; bad.requiredFields = ['password'];
    expect((await c.http().put(`${ADM}/settings`).set(sup).send({ version: 1, config: bad }).expect(400)).body.code).toBe('INVALID_LEAD_CONFIG');
    await c.http().put(`${ADM}/settings`).set(sup).send({ config: next }).expect(400);
    const a = await c.prisma.auditLog.findFirstOrThrow({ where: { action: 'lead.config_changed' } }); expect(a.metadata).toMatchObject({ version: 1 }); expect(JSON.stringify(a.metadata)).not.toContain('Sleep');
    // restore the defaults so later tests see the shipped form
    await c.http().put(`${ADM}/settings`).set(sup).send({ version: 1, config: cur.config }).expect(200);
  });

  it('notification hook (mock messaging): the applicant gets an acknowledgement with the reference and the team alert reaches opted-in staff; test leads send nothing; no contact details in bodies', async () => {
    await c.prisma.opsStaffContact.upsert({ where: { sub: 'ops_l' }, create: { sub: 'ops_l', name: 'Ops Lena', email: 'lena@kiorex.local', roles: ['ops_admin'], locale: 'en', leadAlerts: true, channels: ['EMAIL'] }, update: { email: 'lena@kiorex.local', leadAlerts: true, channels: ['EMAIL'], lastSeenAt: new Date() } });
    const ref = (await post(body({ phone: '+201066660004', email: 'ack@clinic-int.example.org', locale: 'ar' })).expect(201)).body.reference;
    let logs: any[] = [];
    for (let i = 0; i < 30 && logs.length < 2; i++) { await new Promise((r) => setTimeout(r, 100)); logs = await c.prisma.messageLog.findMany({ where: { templateId: { in: ['TODO_NEEDS_HUMAN_site_lead_ack', 'TODO_NEEDS_HUMAN_site_lead_team_alert'] }, body: { contains: ref } } }); }
    expect(logs.map((l) => l.templateId).sort()).toEqual(['TODO_NEEDS_HUMAN_site_lead_ack', 'TODO_NEEDS_HUMAN_site_lead_team_alert']);
    expect(logs.every((l) => l.mode === 'mock' && l.channel === 'EMAIL')).toBe(true);
    expect(logs.find((l) => l.templateId.endsWith('ack')).locale).toBe('ar');
    expect(logs.every((l) => !String(l.body).includes('+201066660004') && !String(l.body).includes('Dr Integration'))).toBe(true);
    const before = await c.prisma.messageLog.count();
    await post(body({ phone: '+201066660005', email: 'quiet@example.test' })).expect(201); await new Promise((r) => setTimeout(r, 300));
    expect(await c.prisma.messageLog.count()).toBe(before);
  });
});
