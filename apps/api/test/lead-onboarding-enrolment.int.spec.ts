import { createCtx, TestCtx } from './harness';
import { resetLeadSubmissionLimits } from '../src/leads/leads.service';

const PUB = '/api/v1/public/leads';
const ADM = '/api/v1/admin/leads';
const OB = '/api/v1/admin/lead-onboarding';
const ENR = '/api/v1/admin/onboarding/enrolments';
let n = 0;
const key = () => `idem_enr_${Date.now().toString(36)}_${++n}_abcd`;
const phone = () => `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const body = (over: object = {}) => ({
  source: 'kiorly-site', env: 'test', mode: 'CONNECTED', providerType: 'LAB', legalName: 'Enrolment Lab LLC', contactName: 'Dr Secret Person', phone: phone(), email: 'secret.person@lab-enr.example.org',
  governorate: 'CAIRO', city: 'Nasr City', specialties: [], modules: ['LAB'], goLive: 'WITHIN_1_MONTH', locale: 'en', note: 'private applicant note', answers: {}, consent: { accepted: true, textVersion: 'draft-2' }, ...over,
});

describe('approval of a CONNECTED onboarding draft pre-creates the enrolment code; cancellation is a reviewer decision only', () => {
  let c: TestCtx; let ops: { Authorization: string }; let sup: { Authorization: string }; let sup2: { Authorization: string }; let kops: { Authorization: string };
  const create = async (over: object = {}) => { const r = await c.http().post(PUB).set('Idempotency-Key', key()).send(body(over)).expect(201); return (await c.prisma.lead.findFirstOrThrow({ where: { ref: r.body.reference } })).id; };
  const patch = (id: string, b: object, who = ops) => c.http().patch(`${ADM}/${id}`).set(who).send(b);
  const draftOf = (leadId: string) => c.prisma.leadOnboardingRequest.findUniqueOrThrow({ where: { leadId } });
  /** a lead moved to ONBOARDING (creates the draft), submitted by ops */
  const submitted = async (over: object = {}) => { const id = await create(over); for (const s of ['QUALIFIED', 'ONBOARDING']) await patch(id, { status: s }).expect(200); const d = await draftOf(id); await c.http().post(`${OB}/${d.id}/submit`).set(ops).expect(200); return { id, d }; };
  beforeAll(async () => {
    c = await createCtx(); ops = await c.as('ops_en', { roles: ['ops_admin'] }); sup = await c.as('sup_en', { roles: ['super_admin'] }); sup2 = await c.as('sup_en2', { roles: ['super_admin'] }); kops = await c.as('kops_en', { roles: ['kiorly_ops'] });
    const routing = { roundRobin: { enabled: false, eligibleSubs: [], activeWithinDays: 30 }, reminders: { enabled: false, remindAfterWorkingHours: 4, escalateAfterWorkingHours: 8 }, workWeek: { days: [0, 1, 2, 3, 4], startHour: 9, endHour: 17 } }; await c.prisma.leadSetting.upsert({ where: { key: 'routing' }, create: { key: 'routing', version: 1, value: routing }, update: { value: routing } });
  });
  afterAll(async () => { await c.prisma.lead.deleteMany({}); await c.prisma.leadSetting.deleteMany({ where: { key: 'routing' } }); await c.prisma.leadRoutingState.deleteMany({}); await c.prisma.opsStaffContact.deleteMany({}); await c.prisma.partnerEnrolment.deleteMany({}); await c.close(); });
  beforeEach(async () => { await resetLeadSubmissionLimits(); });

  it('two super admins approving at the same moment: one wins, exactly ONE code exists', async () => {
    const { d } = await submitted();
    const res = await Promise.all([c.http().post(`${OB}/${d.id}/approve`).set(sup), c.http().post(`${OB}/${d.id}/approve`).set(sup2)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await c.prisma.partnerEnrolment.count({ where: { label: { contains: 'Enrolment Lab' } } })).toBe(1);
    const win = res.find((r) => r.status === 200)!; expect(win.body.enrolmentCode).toMatch(/^kxe_/);
    // approving again later is still a 409 and creates nothing
    await c.http().post(`${OB}/${d.id}/approve`).set(sup2).expect(409); expect(await c.prisma.partnerEnrolment.count({ where: { label: { contains: 'Enrolment Lab' } } })).toBe(1);
    // the code only works for the product it was created for, as the existing mechanism says
    const e = await c.prisma.partnerEnrolment.findFirstOrThrow({ where: { label: { contains: 'Enrolment Lab' } } }); expect(e.kind).toBe('LAB'); expect(e.orgRef).toBeNull();
  });

  it('a STANDALONE draft is approved without any code; no organisation, price or commission record is ever created', async () => {
    const before = { enr: await c.prisma.partnerEnrolment.count(), conn: await c.prisma.partnerConnection.count(), rates: await c.prisma.commissionRatePolicy.count().catch(() => -1) };
    const { d } = await submitted({ mode: 'STANDALONE', legalName: 'Standalone Lab LLC' });
    const ok = await c.http().post(`${OB}/${d.id}/approve`).set(sup).expect(200);
    expect(ok.body.enrolmentCode).toBeUndefined(); expect(ok.body.enrolmentId).toBeNull();
    expect({ enr: await c.prisma.partnerEnrolment.count(), conn: await c.prisma.partnerConnection.count(), rates: await c.prisma.commissionRatePolicy.count().catch(() => -1) }).toEqual(before);
    await c.http().post(`${OB}/${d.id}/enrolment`).set(sup).expect(409); // nothing to issue for a standalone request
  });

  it('reissue: ops_admin gets a new code once, the unused one is revoked, a used one is not replaced, a draft that is not approved has none; the Kiorly roles follow the allow-list', async () => {
    const { d } = await submitted({ legalName: 'Reissue Lab LLC' });
    await c.http().post(`${OB}/${d.id}/enrolment`).set(ops).expect(409); // still SUBMITTED
    const ok = await c.http().post(`${OB}/${d.id}/approve`).set(sup).expect(200); const first = ok.body.enrolmentId as string;
    const re = await c.http().post(`${OB}/${d.id}/enrolment`).set(ops).expect(200);
    expect(re.body.enrolmentCode).toMatch(/^kxe_/); expect(re.body.enrolmentCode).not.toBe(ok.body.enrolmentCode); expect(re.body.enrolmentId).not.toBe(first); expect(re.body.shownOnce).toBe(true);
    expect((await c.prisma.partnerEnrolment.findUniqueOrThrow({ where: { id: first } })).status).toBe('REVOKED');
    expect((await c.prisma.partnerEnrolment.findMany({ where: { label: { contains: 'Reissue Lab' }, status: 'ACTIVE' } })).map((x) => x.id)).toEqual([re.body.enrolmentId]);
    // a GET never carries a code
    const got = (await c.http().get(`${OB}/${d.id}`).set(ops).expect(200)).body; expect(JSON.stringify(got)).not.toContain(re.body.enrolmentCode); expect(got.enrolment.status).toBe('ACTIVE');
    // two reissues at once: one wins, the other is told to reload; still one ACTIVE code
    const two = await Promise.all([c.http().post(`${OB}/${d.id}/enrolment`).set(ops), c.http().post(`${OB}/${d.id}/enrolment`).set(sup)]);
    expect(two.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await c.prisma.partnerEnrolment.count({ where: { label: { contains: 'Reissue Lab' }, status: 'ACTIVE' } })).toBe(1);
    // used code: not replaced here
    const cur = (await c.prisma.leadOnboardingRequest.findUniqueOrThrow({ where: { id: d.id } })).enrolmentId!; await c.prisma.partnerEnrolment.update({ where: { id: cur }, data: { status: 'USED', usedAt: new Date() } });
    expect((await c.http().post(`${OB}/${d.id}/enrolment`).set(ops).expect(409)).body.code).toBe('ENROLMENT_USED');
    // audit: ids only, never the code
    const audit = JSON.stringify(await c.prisma.auditLog.findMany({ where: { OR: [{ resource: 'LeadOnboardingRequest' }, { resource: 'PartnerEnrolment' }] } }));
    for (const code of [ok.body.enrolmentCode, re.body.enrolmentCode]) expect(audit).not.toContain(code);
    expect(audit).toContain('lead_onboarding.enrolment_issued');
    // kiorly_ops may read and review but may not issue codes (admin level); approve is never theirs
    await c.http().post(`${OB}/${d.id}/enrolment`).set(kops).expect(403); await c.http().post(`${OB}/${d.id}/approve`).set(kops).expect(403);
  });

  it('an approved draft that has no code yet (approved before this feature) gets one through the same route', async () => {
    const { d } = await submitted({ legalName: 'Legacy Lab LLC' });
    await c.prisma.leadOnboardingRequest.update({ where: { id: d.id }, data: { status: 'APPROVED', decidedBy: 'sup_old', decidedAt: new Date(), submittedBy: 'ops_en' } });
    const re = await c.http().post(`${OB}/${d.id}/enrolment`).set(sup).expect(200); expect(re.body.enrolmentCode).toMatch(/^kxe_/);
    expect(await c.prisma.partnerEnrolment.count({ where: { label: { contains: 'Legacy Lab' } } })).toBe(1);
  });

  it('LOST never cancels a draft; only a reviewer does, with a reason, audited; a cancelled draft can be reopened; an approved one cannot be cancelled', async () => {
    const id = await create({ legalName: 'Lost Then Cancelled LLC' }); for (const s of ['QUALIFIED', 'ONBOARDING']) await patch(id, { status: s }).expect(200);
    const d = await draftOf(id);
    await patch(id, { status: 'LOST', lostReason: undefined }).expect(200);
    const after = await draftOf(id); expect(after.status).toBe('DRAFT'); expect(after.decidedBy).toBeNull(); // untouched by the lost lead
    const view = (await c.http().get(`${OB}/${d.id}`).set(ops).expect(200)).body; expect(view).toMatchObject({ status: 'DRAFT', leadStatus: 'LOST' }); expect(view.blockers).toEqual(['LEAD_NOT_ACTIVE']);
    expect(await c.prisma.auditLog.count({ where: { action: 'lead_onboarding.cancelled', resourceId: d.id } })).toBe(0);
    await c.http().post(`${OB}/${d.id}/cancel`).set(ops).send({}).expect(400); await c.http().post(`${OB}/${d.id}/cancel`).set(ops).send({ reason: '   ' }).expect(400);
    await c.http().post(`${OB}/${d.id}/cancel`).set(await c.as('pat_en', { roles: ['patient'] })).send({ reason: 'x' }).expect(403);
    const done = await c.http().post(`${OB}/${d.id}/cancel`).set(kops).send({ reason: 'applicant lost interest, confirmed by phone' }).expect(200);
    expect(done.body).toMatchObject({ status: 'CANCELLED', decisionNote: 'applicant lost interest, confirmed by phone', decidedBy: 'kops_en' });
    const a = await c.prisma.auditLog.findFirstOrThrow({ where: { action: 'lead_onboarding.cancelled', resourceId: d.id } }); expect(a.actor).toBe('kops_en'); expect(JSON.stringify(a.metadata)).toContain('applicant lost interest');
    const trail = (await c.http().get(`${ADM}/${id}`).set(ops).expect(200)).body.events.filter((e: any) => e.kind === 'ONBOARDING').map((e: any) => e.data.action); expect(trail).toEqual(['DRAFT_CREATED', 'CANCELLED']);
    await c.http().post(`${OB}/${d.id}/cancel`).set(ops).send({ reason: 'again' }).expect(409);
    await c.http().post(`${OB}/${d.id}/reopen`).set(ops).expect(200);
    // an approved draft is final
    const { d: d2 } = await submitted({ legalName: 'Approved Not Cancellable LLC' }); await c.http().post(`${OB}/${d2.id}/approve`).set(sup).expect(200);
    expect((await c.http().post(`${OB}/${d2.id}/cancel`).set(ops).send({ reason: 'oops' }).expect(409)).body.code).toBe('INVALID_STATE');
  });

  it('a lead that goes LOST after the draft was submitted leaves the submitted draft as it is (open for a reviewer)', async () => {
    const { id, d } = await submitted({ legalName: 'Lost After Submit LLC' });
    await patch(id, { status: 'LOST' }).expect(200);
    expect((await draftOf(id)).status).toBe('SUBMITTED');
    expect((await c.http().get(`${OB}/${d.id}`).set(ops).expect(200)).body).toMatchObject({ status: 'SUBMITTED', leadStatus: 'LOST' });
    await c.http().post(`${OB}/${d.id}/cancel`).set(ops).send({ reason: 'lead lost' }).expect(200);
  });
});
