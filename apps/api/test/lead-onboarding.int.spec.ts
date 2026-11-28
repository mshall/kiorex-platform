import { createCtx, TestCtx } from './harness';
import { resetLeadSubmissionLimits } from '../src/leads/leads.service';

const PUB = '/api/v1/public/leads';
const ADM = '/api/v1/admin/leads';
const OB = '/api/v1/admin/lead-onboarding';
let n = 0;
const key = () => `idem_ob_${Date.now().toString(36)}_${++n}_abcd`;
const phone = () => `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const body = (over: object = {}) => ({
  source: 'kiorly-site', env: 'test', mode: 'CONNECTED', providerType: 'CLINIC', legalName: 'Onboarding Clinic LLC', contactName: 'Dr Secret Person', phone: phone(), email: 'secret.person@clinic-ob.example.org',
  governorate: 'CAIRO', city: 'Nasr City', specialties: ['PEDIATRICS'], modules: ['CLINIC'], goLive: 'WITHIN_1_MONTH', locale: 'en', note: 'private applicant note', answers: {}, consent: { accepted: true, textVersion: 'draft-2' }, ...over,
});

describe('WON join request creates ONE DRAFT onboarding request (never an activation)', () => {
  let c: TestCtx; let ops: { Authorization: string }; let ops2: { Authorization: string }; let sup: { Authorization: string }; let sup2: { Authorization: string };
  const create = async (over: object = {}) => { const r = await c.http().post(PUB).set('Idempotency-Key', key()).send(body(over)).expect(201); return (await c.prisma.lead.findFirstOrThrow({ where: { ref: r.body.reference } })).id; };
  const patch = (id: string, who: { Authorization: string }, b: object) => c.http().patch(`${ADM}/${id}`).set(who).send(b);
  const toWon = async (id: string, who = ops) => { for (const s of ['QUALIFIED', 'ONBOARDING', 'WON']) await patch(id, who, { status: s }).expect(200); };
  const draftOf = (leadId: string) => c.prisma.leadOnboardingRequest.findUnique({ where: { leadId } });
  beforeAll(async () => {
    c = await createCtx(); ops = await c.as('ops_ob', { roles: ['ops_admin'] }); ops2 = await c.as('ops_ob2', { roles: ['ops_admin'] }); sup = await c.as('sup_ob', { roles: ['super_admin'] }); sup2 = await c.as('sup_ob2', { roles: ['super_admin'] });
    await c.http().get(`${ADM}/owners`).set(ops); await c.http().get(`${ADM}/owners`).set(ops2); // registers the console users as assignable owners
    await c.prisma.opsStaffContact.update({ where: { sub: 'ops_ob2' }, data: { name: 'Mona', email: 'mona@kiorex.local', leadAlerts: true, channels: ['EMAIL'], locale: 'ar' } });
  });
  afterAll(async () => { await c.prisma.lead.deleteMany({}); await c.close(); });
  beforeEach(async () => { await resetLeadSubmissionLimits(); });

  it('WON creates exactly one draft, prefilled, without contact data; before WON nothing exists; LOST never creates one', async () => {
    const id = await create();
    for (const s of ['QUALIFIED', 'ONBOARDING']) { await patch(id, ops, { status: s }).expect(200); expect(await draftOf(id)).toBeNull(); }
    const won = await patch(id, ops, { status: 'WON' }).expect(200);
    const d = await draftOf(id);
    expect(d).toMatchObject({ status: 'DRAFT', kind: 'CLINIC', legalName: 'Onboarding Clinic LLC', providerType: 'CLINIC', mode: 'CONNECTED', modules: ['CLINIC'], market: 'EG', assigneeSub: null, isTest: false, createdBy: 'ops_ob' });
    expect(d!.contactRef).toMatch(/^KL-/);
    expect(JSON.stringify(d)).not.toMatch(/secret\.person|Dr Secret|private applicant|\+2010/);
    expect(won.body.onboardingRequest).toMatchObject({ id: d!.id, status: 'DRAFT', kind: 'CLINIC' });
    const lost = await create(); await patch(lost, ops, { status: 'LOST' }).expect(200); expect(await draftOf(lost)).toBeNull();
    await patch(lost, ops, { status: 'WON' }).expect(409); // NEW -> WON is not a transition; LOST -> NEW -> ... -> WON would still create exactly one
    expect(await c.prisma.leadOnboardingRequest.count({ where: { leadId: lost } })).toBe(0);
  });

  it('reopening WON -> ONBOARDING -> WON never creates a second draft (idempotent per lead); concurrent saves create one', async () => {
    const id = await create({ providerType: 'LAB' });
    await toWon(id);
    const first = await draftOf(id); expect(first).toMatchObject({ kind: 'LAB' });
    await patch(id, ops, { status: 'ONBOARDING' }).expect(200); await patch(id, ops, { status: 'WON' }).expect(200);
    expect((await draftOf(id))!.id).toBe(first!.id); expect(await c.prisma.leadOnboardingRequest.count({ where: { leadId: id } })).toBe(1);
    const again = await c.http().post(`${OB}/by-lead/${id}`).set(ops).expect(200); expect(again.body).toMatchObject({ id: first!.id, created: false });
    const id2 = await create({ providerType: 'PHARMACY' }); for (const s of ['QUALIFIED', 'ONBOARDING']) await patch(id2, ops, { status: s }).expect(200);
    const svc = c.get((await import('../src/leads/lead-onboarding.service')).LeadOnboardingService); const row = await c.prisma.lead.update({ where: { id: id2 }, data: { status: 'WON' } });
    const [a, b] = await Promise.all([svc.ensureForLead({ sub: 'x' }, row), svc.ensureForLead({ sub: 'y' }, row)]);
    expect(a.request.id).toBe(b.request.id); expect([a.created, b.created].filter(Boolean)).toHaveLength(1); expect(await c.prisma.leadOnboardingRequest.count({ where: { leadId: id2 } })).toBe(1);
  });

  it('ONBOARDING only creates one when LEAD_ONBOARDING_DRAFT_ON says so (default: WON only)', async () => {
    const id = await create(); for (const s of ['QUALIFIED', 'ONBOARDING']) await patch(id, ops, { status: s }).expect(200);
    expect(await draftOf(id)).toBeNull();
    const manual = await c.http().post(`${OB}/by-lead/${id}`).set(ops).expect(409); expect(manual.body.code).toBe('LEAD_NOT_READY');
    process.env.LEAD_ONBOARDING_DRAFT_ON = 'WON,ONBOARDING';
    try { const id3 = await create(); await patch(id3, ops, { status: 'QUALIFIED' }).expect(200); await patch(id3, ops, { status: 'ONBOARDING' }).expect(200); expect(await draftOf(id3)).not.toBeNull(); await patch(id3, ops, { status: 'WON' }).expect(200); expect(await c.prisma.leadOnboardingRequest.count({ where: { leadId: id3 } })).toBe(1); }
    finally { delete process.env.LEAD_ONBOARDING_DRAFT_ON; }
  });

  it('the draft defaults to the lead owner, who is notified once (mock, opt-in only, reference and type only); an unassigned lead gets an unassigned draft', async () => {
    const id = await create({ providerType: 'CHAIN', branches: 3 });
    await patch(id, ops, { ownerSub: 'ops_ob2' }).expect(200); await toWon(id);
    const d = await draftOf(id); expect(d).toMatchObject({ assigneeSub: 'ops_ob2', assigneeName: 'Mona' });
    let logs: any[] = [];
    for (let i = 0; i < 30 && !logs.length; i++) { await new Promise((r) => setTimeout(r, 100)); logs = await c.prisma.messageLog.findMany({ where: { templateId: 'TODO_NEEDS_HUMAN_site_lead_onboarding_assigned', body: { contains: d!.contactRef } } }); }
    expect(logs).toHaveLength(1); expect(logs[0]).toMatchObject({ mode: 'mock', channel: 'EMAIL', locale: 'ar' });
    expect(String(logs[0].body)).not.toMatch(/secret\.person|Dr Secret|\+2010/);
    const lonely = await create(); await toWon(lonely); expect(await draftOf(lonely)).toMatchObject({ assigneeSub: null });
  });

  it('review workflow: edit the draft, submit needs a kind, a different super admin approves, nothing else is created; every step is audited and shown on the lead trail', async () => {
    const id = await create({ providerType: 'OTHER', answers: { otherDescription: 'Medical transport' } }); await toWon(id);
    const d = (await draftOf(id))!; expect(d.kind).toBeNull();
    expect((await c.http().post(`${OB}/${d.id}/submit`).set(ops).expect(409)).body).toMatchObject({ code: 'SUBMIT_BLOCKED', blockers: ['KIND_REQUIRED'] });
    await c.http().patch(`${OB}/${d.id}`).set(ops).send({ kind: 'NOPE' }).expect(400);
    await c.http().patch(`${OB}/${d.id}`).set(ops).send({ kind: 'PHARMACY', note: 'needs the owner licence copy', assigneeSub: 'ops_ob2' }).expect(200);
    await c.http().post(`${OB}/${d.id}/approve`).set(sup).expect(409); // not submitted yet
    await c.http().post(`${OB}/${d.id}/submit`).set(ops).expect(200);
    await c.http().patch(`${OB}/${d.id}`).set(ops).send({ note: 'x' }).expect(409); // only a draft is editable
    await c.http().post(`${OB}/${d.id}/approve`).set(ops2).expect(403); // ops_admin cannot approve (super admin only)
    const sameMaker = await c.http().post(`${OB}/${d.id}/approve`).set(await c.as('ops_ob', { roles: ['super_admin'] })).expect(403); expect(sameMaker.body.code).toBe('TWO_PERSON_RULE'); // the submitter, even as a super admin
    const ok = await c.http().post(`${OB}/${d.id}/approve`).set(sup).send({ note: 'checked' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'APPROVED', kind: 'PHARMACY', decidedBy: 'sup_ob', submittedBy: 'ops_ob' });
    await c.http().post(`${OB}/${d.id}/approve`).set(sup2).expect(409); await c.http().post(`${OB}/${d.id}/cancel`).set(ops).expect(409);
    // approval created nothing else: no enrolment code, no connection, no organisation
    expect(await c.prisma.partnerEnrolment.count({ where: { label: { contains: 'Onboarding Clinic' } } })).toBe(0);
    const audit = (await c.prisma.auditLog.findMany({ where: { resource: 'LeadOnboardingRequest', resourceId: d.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(audit).toEqual(['lead_onboarding.draft_created', 'lead_onboarding.updated', 'lead_onboarding.submitted', 'lead_onboarding.approved']);
    const detail = (await c.http().get(`${ADM}/${id}`).set(ops).expect(200)).body;
    expect(detail.onboardingRequest).toMatchObject({ id: d.id, status: 'APPROVED', kind: 'PHARMACY' });
    expect(detail.events.filter((e: any) => e.kind === 'ONBOARDING').map((e: any) => e.data.action)).toEqual(['DRAFT_CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED']);
    expect(JSON.stringify(await c.prisma.auditLog.findMany({ where: { resource: 'LeadOnboardingRequest' } }))).not.toMatch(/secret\.person|Dr Secret|\+2010/);
    // the database repeats the two-person rule
    const other = await create(); await toWon(other); const o = (await draftOf(other))!;
    await expect(c.prisma.leadOnboardingRequest.update({ where: { id: o.id }, data: { status: 'APPROVED', submittedBy: 'same', decidedBy: 'same' } })).rejects.toThrow();
  });

  it('reject needs a reason and a different super admin; cancel and reopen return the same single row; a lost lead blocks submitting', async () => {
    const id = await create(); await toWon(id); const d = (await draftOf(id))!;
    await c.http().post(`${OB}/${d.id}/submit`).set(ops).expect(200);
    await c.http().post(`${OB}/${d.id}/reject`).set(sup).send({}).expect(400);
    const rej = await c.http().post(`${OB}/${d.id}/reject`).set(sup).send({ reason: 'licence unclear' }).expect(200); expect(rej.body).toMatchObject({ status: 'REJECTED', decisionNote: 'licence unclear' });
    const re = await c.http().post(`${OB}/${d.id}/reopen`).set(ops).expect(200); expect(re.body).toMatchObject({ id: d.id, status: 'DRAFT', submittedBy: null, decidedBy: null });
    expect(await c.prisma.leadOnboardingRequest.count({ where: { leadId: id } })).toBe(1);
    await c.http().post(`${OB}/${d.id}/cancel`).set(ops).send({ reason: 'duplicate' }).expect(200);
    await c.http().post(`${OB}/${d.id}/reopen`).set(ops).expect(200);
    await patch(id, ops, { status: 'ONBOARDING' }).expect(200); await patch(id, ops, { status: 'LOST' }).expect(200);
    expect((await c.http().post(`${OB}/${d.id}/submit`).set(ops).expect(409)).body.blockers).toEqual(['LEAD_NOT_ACTIVE']);
  });

  it('access and listing: no token 401, a patient 403; filters by status, assignee, mode; test leads are tagged and removed with their drafts', async () => {
    const patient = await c.as('pat_ob', { roles: ['patient'] });
    await c.http().get(OB).expect(401); await c.http().get(OB).set(patient).expect(403); await c.http().post(`${OB}/ld_x/approve`).set(ops).expect(403);
    const t = await create({ legalName: '[TEST] Onboarding Test Lab', providerType: 'LAB', mode: 'STANDALONE', email: 'x@example.test' }); await toWon(t);
    const list = (await c.http().get(`${OB}?test=only&mode=STANDALONE&status=DRAFT`).set(ops).expect(200)).body;
    expect(list.items.map((x: any) => x.legalName)).toContain('[TEST] Onboarding Test Lab'); expect(list.items.every((x: any) => x.isTest && x.mode === 'STANDALONE')).toBe(true);
    expect((await c.http().get(`${OB}?assignee=ops_ob2`).set(ops).expect(200)).body.items.every((x: any) => x.assigneeSub === 'ops_ob2')).toBe(true);
    await c.http().get(`${OB}?status=BOGUS`).set(ops).expect(400);
    const before = await c.prisma.leadOnboardingRequest.count({ where: { isTest: true } }); expect(before).toBeGreaterThan(0);
    await c.http().post(`${ADM}/test/remove`).set(sup).send({ confirm: true }).expect(200);
    expect(await c.prisma.leadOnboardingRequest.count({ where: { isTest: true } })).toBe(0);
  });
});
