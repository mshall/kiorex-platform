import { createCtx, TestCtx } from './harness';
import { LandingEditService } from '../src/growth/seo-automation/landing-edit.service';

const A = { sub: 'adm_a', roles: ['super_admin'] }; const B = { sub: 'adm_b', roles: ['super_admin'] }; const OPS = { sub: 'ops_1', roles: ['ops_admin'] };
const code = async (p: Promise<unknown>) => { try { await p; return 'NO_ERROR'; } catch (e) { return (e as { getResponse(): { code: string } }).getResponse().code; } };
const good = { pageKey: 'district:cardiology/cairo/maadi', locale: 'en', title: 'Cardiologists in Maadi, Cairo: book online | Kiorex', description: 'Verified cardiologists in Maadi with live availability. Compare fees and languages, then book a visit.' };

/** G-18 landing page editor: maker-checker, quality gate, one active edit per page and locale, withdraw, audit. Real Postgres. */
describe('LandingEditService (G-18)', () => {
  let c: TestCtx; let svc: LandingEditService;
  beforeAll(async () => { c = await createCtx(); svc = c.get(LandingEditService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); svc.invalidate(); });

  it('draft, submit, approve through two different super admins; every transition is audited; the public reader sees only the ACTIVE edit', async () => {
    const d = await svc.createDraft(A, good);
    expect(d).toMatchObject({ status: 'DRAFT', version: 1, createdBy: 'adm_a' });
    expect(await svc.activeFor('EG', good.pageKey, 'en')).toBeNull();
    const s = await svc.submit(A, d.id); expect(s.status).toBe('PENDING_APPROVAL'); expect((s.quality as { passed: boolean }).passed).toBe(true);
    expect(await svc.activeFor('EG', good.pageKey, 'en')).toBeNull();
    const a = await svc.approve(B, d.id); expect(a).toMatchObject({ status: 'ACTIVE', decidedBy: 'adm_b' });
    expect(await svc.activeFor('EG', good.pageKey, 'en')).toMatchObject({ title: good.title, version: 1 });
    expect(await svc.activeFor('EG', good.pageKey, 'ar')).toBeNull();
    const audits = await c.prisma.auditLog.findMany({ where: { resourceId: d.id }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((x) => x.action)).toEqual(['growth.landing_edit.create', 'growth.landing_edit.submit', 'growth.landing_edit.approve']);
  });
  it('self approval and self rejection are refused, and the database CHECK holds even if the service were bypassed', async () => {
    const d = await svc.createDraft(A, good); await svc.submit(A, d.id);
    expect(await code(svc.approve(A, d.id))).toBe('GROWTH_CONFIG_SELF_APPROVAL'); expect(await code(svc.reject(A, d.id, 'mine'))).toBe('GROWTH_CONFIG_SELF_APPROVAL');
    await expect(c.prisma.growthLandingEdit.update({ where: { id: d.id }, data: { status: 'ACTIVE', decidedBy: 'adm_a' } })).rejects.toThrow(/maker_checker/);
  });
  it('only super admins act; only the author edits or submits a draft; provider pages and bad input are refused', async () => {
    expect(await code(svc.createDraft(OPS, good))).toBe('FORBIDDEN_ROLE');
    const d = await svc.createDraft(A, good);
    expect(await code(svc.updateDraft(B, d.id, { title: 'x' }))).toBe('FORBIDDEN_ROLE'); expect(await code(svc.submit(B, d.id))).toBe('FORBIDDEN_ROLE');
    expect(await code(svc.approve(B, d.id))).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN'); // a draft is not approvable
    for (const bad of [{ pageKey: 'doctor:sara-hassan' }, { pageKey: 'clinic:nile-clinic' }, { pageKey: 'hub:../x' }, { locale: 'fr' }, { title: '' }, { title: 'x'.repeat(121) }, { description: 'y'.repeat(321) }]) expect(await code(svc.createDraft(A, { ...good, ...bad } as never))).toBe('GROWTH_INVALID_REQUEST');
  });
  it('the quality gate refuses claims and placeholders on submit (stored with the draft), warns on length, and runs again at approval', async () => {
    const claim = await svc.createDraft(A, { ...good, title: 'The best cardiologists in Maadi, guaranteed results | Kiorex', description: 'We guarantee a cure from the best doctors in Maadi, book today and see the difference.' });
    const r = await code(svc.submit(A, claim.id)); expect(r).toBe('LANDING_EDIT_QUALITY');
    expect(((await c.prisma.growthLandingEdit.findUniqueOrThrow({ where: { id: claim.id } })).quality as { passed: boolean }).passed).toBe(false);
    expect((await c.prisma.growthLandingEdit.findUniqueOrThrow({ where: { id: claim.id } })).status).toBe('DRAFT');
    const leak = await svc.createDraft(A, { ...good, pageKey: 'city:cardiology/cairo', title: 'Cardiologists in {{city}} | Kiorex', description: 'Verified cardiologists in Cairo with live availability. Compare fees and languages, then book.' });
    const q = await svc.quality('EG', leak); expect(q.warnings.map((w) => w.id)).toContain('title-meta');
  });
  it('a second approval supersedes the first for that page and locale; a withdrawal removes the active edit at once; closed edits stay closed', async () => {
    const one = await svc.createDraft(A, good); await svc.submit(A, one.id); await svc.approve(B, one.id);
    const two = await svc.createDraft(A, { ...good, title: 'Cardiologists in Maadi: compare and book | Kiorex' }); expect(two.version).toBe(2);
    await svc.submit(A, two.id); await svc.approve(B, two.id);
    expect((await c.prisma.growthLandingEdit.findUniqueOrThrow({ where: { id: one.id } })).status).toBe('SUPERSEDED');
    expect(await svc.activeFor('EG', good.pageKey, 'en')).toMatchObject({ version: 2 });
    expect(await code(svc.withdraw(B, two.id, 'short'))).toBe('GROWTH_INVALID_REQUEST');
    expect((await svc.withdraw(B, two.id, 'wording under review again')).status).toBe('WITHDRAWN'); expect(await svc.activeFor('EG', good.pageKey, 'en')).toBeNull();
    expect(await code(svc.withdraw(B, two.id, 'withdrawing it a second time'))).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN');
    // the database allows exactly one ACTIVE row per page and locale
    await expect(c.prisma.$executeRaw`INSERT INTO "GrowthLandingEdit" ("id","market","pageKey","locale","version","status","title","description","createdBy","decidedBy") VALUES ('x1','EG',${good.pageKey},'en',90,'ACTIVE','t','d','a','b'), ('x2','EG',${good.pageKey},'en',91,'ACTIVE','t','d','a','b')`).rejects.toThrow();
  });
  it('rejecting closes a submitted edit with a note and keeps the text out of the public reader', async () => {
    const d = await svc.createDraft(A, good); await svc.submit(A, d.id);
    const r = await svc.reject(B, d.id, 'wording needs counsel review'); expect(r).toMatchObject({ status: 'REJECTED', decisionNote: 'wording needs counsel review' });
    expect(await svc.activeFor('EG', good.pageKey, 'en')).toBeNull(); expect(await code(svc.approve(B, d.id))).toBe('GROWTH_CONFIG_TRANSITION_FORBIDDEN');
  });
});
