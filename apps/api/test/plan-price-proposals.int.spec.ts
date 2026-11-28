import { createCtx, TestCtx } from './harness';
import { SitePlansService } from '../src/site-plans/site-plans.service';
import { ProductPlansClient } from '../src/site-plans/product-plans.client';
import { ApiError } from '../src/common/errors';

const ADMIN = '/api/v1/admin/kiorly-plans';
const PUBLIC = '/api/v1/public/plans';
const adminState = () => ({
  markets: [{ id: 'mk_EG', code: 'EG', defaultCurrency: 'EGP' }],
  plans: [
    { id: 'pl_lite', key: 'LITE', nameEn: 'Lite', nameAr: 'لايت', isPublic: true, sortOrder: 10, entitlements: [], prices: [{ id: 'pp_a', planId: 'pl_lite', marketId: 'mk_EG', currency: 'EGP', interval: 'MONTHLY', unit: 'PER_TENANT', amount: '100', includedClinicians: 1, extraClinicianAmount: null, cohortKey: null, priceVersion: 1, validFrom: '2026-01-01T00:00:00Z', validTo: null }] },
    { id: 'pl_pro', key: 'PRO', nameEn: 'Pro', nameAr: 'برو', isPublic: true, sortOrder: 20, entitlements: [], prices: [] },
  ],
});

/** In-memory stand-in for the product price routes (the real routes are covered in each product's own e2e tests). Same rules: idempotent per proposal, append-only order. */
class FakeProduct {
  prices: any[] = []; calls: any[] = []; down = false; orgs = 3;
  overview = async () => { if (this.down) throw new ApiError(503, 'PRODUCT_UNAVAILABLE', 'down'); return { editions: ['LITE', 'PRO', 'CHAIN'], prices: this.prices, organisations: [{ edition: 'PRO', marketCode: 'EG', count: this.orgs }] }; };
  price = async (_k: string, body: any) => {
    this.calls.push(body);
    if (this.down) throw new ApiError(503, 'PRODUCT_UNAVAILABLE', 'down');
    const seg = this.prices.filter((p) => p.edition === body.edition && p.marketCode === body.marketCode && p.interval === body.interval);
    const from = body.validFrom ?? new Date().toISOString();
    const v = Math.max(0, ...seg.map((p) => p.priceVersion)) + 1;
    if (body.preview) return { preview: true, priceVersion: v, supersedes: seg.length > 0, validFrom: from, impact: { organisationsAffected: this.orgs, from: seg.length ? { amount: seg[seg.length - 1].amount, currency: seg[seg.length - 1].currency, priceVersion: seg.length } : null, to: { amount: body.amount, currency: body.currency } } };
    const hit = this.prices.find((p) => p.proposalId === body.approval.proposalId);
    if (hit) return { published: true, idempotent: true, price: hit };
    if (body.actor.id === body.approval.proposedBy) throw new ApiError(403, 'TWO_PERSON_RULE', 'two');
    const row = { id: `px_${this.prices.length + 1}`, edition: body.edition, marketCode: body.marketCode, interval: body.interval, currency: body.currency, amount: body.amount, validFrom: from, validTo: null, priceVersion: v, proposalId: body.approval.proposalId };
    this.prices.push(row);
    return { published: true, idempotent: false, price: row };
  };
}

describe('Kiorly plan price proposals: maker-checker for Clinic, Pharmacy and Lab', () => {
  let c: TestCtx; let svc: SitePlansService; let fake: FakeProduct;
  beforeAll(async () => { c = await createCtx(); svc = c.app.get(SitePlansService); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); svc.invalidate(); c.kiorly.plansAdmin = adminState(); c.kiorly.plansPublic = { market: { code: 'EG', currency: 'EGP' }, plans: [] };
    await c.prisma.$executeRawUnsafe('ALTER TABLE "KiorlyPlanPriceProposal" DISABLE TRIGGER kiorly_plan_price_proposal_guard');
    await c.prisma.$executeRawUnsafe('DELETE FROM "KiorlyPlanPriceProposal"');
    await c.prisma.$executeRawUnsafe('ALTER TABLE "KiorlyPlanPriceProposal" ENABLE TRIGGER kiorly_plan_price_proposal_guard');
    fake = new FakeProduct();
    const pc = c.app.get(ProductPlansClient);
    jest.spyOn(pc, 'configured').mockReturnValue(true);
    jest.spyOn(pc, 'overview').mockImplementation(fake.overview as never);
    jest.spyOn(pc, 'price').mockImplementation(fake.price as never);
  });
  afterEach(() => { jest.restoreAllMocks(); });
  const tok = async (sub: string, roles: string[]) => ({ Authorization: `Bearer ${await c.token({ sub, roles, email: `${sub}@example.com` })}` });
  const ops = () => tok('ops_1', ['ops_admin']);
  const sa1 = () => tok('super_1', ['super_admin']);
  const sa2 = () => tok('super_2', ['super_admin']);
  const fin = () => tok('fin_1', ['finance']);
  const body = (o: Record<string, unknown> = {}) => ({ product: 'PHARMACY', planRef: 'PRO', marketCode: 'EG', interval: 'MONTHLY', currency: 'EGP', amount: '250.00', ...o });
  const propose = async (who: () => Promise<{ Authorization: string }>, o: Record<string, unknown> = {}, status = 201) => (await c.http().post(`${ADMIN}/proposals`).set(await who()).send(body(o)).expect(status)).body;
  const decide = async (who: () => Promise<{ Authorization: string }>, id: string, action: 'approve' | 'reject' | 'withdraw', status = 200, note?: string) => (await c.http().post(`${ADMIN}/proposals/${id}/${action}`).set(await who()).send(note ? { note } : {}).expect(status)).body;

  it('roles: finance and the public are refused everywhere; ops may preview and propose but never decide', async () => {
    await c.http().get(`${ADMIN}/proposals`).expect(401);
    await c.http().get(`${ADMIN}/proposals`).set(await fin()).expect(403);
    await c.http().post(`${ADMIN}/proposals`).set(await fin()).send(body()).expect(403);
    await c.http().post(`${ADMIN}/prices/preview`).set(await fin()).send(body()).expect(403);
    const p = await propose(ops);
    await c.http().post(`${ADMIN}/proposals/${p.id}/approve`).set(await ops()).send({}).expect(403);
    await c.http().post(`${ADMIN}/proposals/${p.id}/reject`).set(await ops()).send({}).expect(403);
    expect(fake.calls.filter((x) => !x.preview)).toHaveLength(0);
  });

  it('Kiorly-only roles (ADR-062): kiorly_ops and kiorly_admin may preview, propose, list and withdraw their own; they never approve or reject; the old direct price route stays closed to them', async () => {
    for (const role of ['kiorly_ops', 'kiorly_admin']) {
      const h = await tok(`k_${role}`, [role]);
      const o = (await c.http().get(ADMIN).set(h).expect(200)).body;
      expect(o.capabilities).toEqual({ canPropose: true, canApprove: false, you: `k_${role}` });
      await c.http().post(`${ADMIN}/prices/preview`).set(h).send(body()).expect(200);
      const p = (await c.http().post(`${ADMIN}/proposals`).set(h).send(body({ planRef: role === 'kiorly_ops' ? 'PRO' : 'CHAIN' })).expect(201)).body;
      await c.http().post(`${ADMIN}/proposals/${p.id}/approve`).set(h).send({}).expect(403);
      await c.http().post(`${ADMIN}/proposals/${p.id}/reject`).set(h).send({}).expect(403);
      await c.http().post(`${ADMIN}/clinic/pl_pro/prices`).set(h).send({ preview: true }).expect(403);
      expect((await c.http().get(`${ADMIN}/proposals`).set(h).expect(200)).body.some((x: { id: string }) => x.id === p.id)).toBe(true);
      await c.http().post(`${ADMIN}/proposals/${p.id}/withdraw`).set(await tok('someone_else', [role])).send({}).expect(403); // only the proposer
      expect((await c.http().post(`${ADMIN}/proposals/${p.id}/withdraw`).set(h).send({}).expect(200)).body.status).toBe('WITHDRAWN');
    }
    expect(fake.prices).toHaveLength(0);
  });

  it('nothing is published before approval; a preview writes nothing, a proposal stores the preview and the warnings', async () => {
    const pv = (await c.http().post(`${ADMIN}/prices/preview`).set(await ops()).send(body()).expect(200)).body;
    expect(pv.preview).toMatchObject({ priceVersion: 1, supersedes: false, affected: 3 });
    expect(await c.prisma.kiorlyPlanPriceProposal.count()).toBe(0);
    const p = await propose(ops);
    expect(p).toMatchObject({ status: 'PENDING', product: 'PHARMACY', planKey: 'PRO', amount: '250.00', proposedBy: 'ops_1', publishedVersion: null });
    expect(p.preview).toMatchObject({ affected: 3 });
    expect(fake.prices).toHaveLength(0);
    expect((await c.http().get(`${PUBLIC}`).expect(200)).body.modules.find((m: any) => m.id === 'pharmacy').plans.every((x: any) => x.priceStatus === 'TO_BE_ANNOUNCED')).toBe(true);
  });

  it('a different super admin approves: published through the product, recorded, audited, and the landing API shows it once effective', async () => {
    const p = await propose(ops);
    const a = await decide(sa1, p.id, 'approve', 200, 'looks right');
    expect(a).toMatchObject({ status: 'APPROVED', decidedBy: 'super_1', publishedVersion: 1, decisionNote: 'looks right' });
    expect(fake.prices).toHaveLength(1);
    expect(fake.calls.at(-1)).toMatchObject({ approval: { proposalId: p.id, proposedBy: 'ops_1' }, actor: { id: 'super_1', email: 'super_1@example.com' } });
    const audits = await c.prisma.auditLog.findMany({ where: { resourceId: p.id }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((x) => x.action)).toEqual(['kiorly.plans.price_proposed', 'kiorly.plans.price_approved']);
    const pharm = (await c.http().get(PUBLIC).expect(200)).body.modules.find((m: any) => m.id === 'pharmacy');
    expect(pharm.plans.find((x: any) => x.id === 'pro')).toMatchObject({ priceStatus: 'SET', prices: [{ interval: 'MONTHLY', unit: 'PER_TENANT', amount: '250.00', currency: 'EGP' }] });
    expect(pharm.plans.find((x: any) => x.id === 'lite').priceStatus).toBe('TO_BE_ANNOUNCED');
    await decide(sa2, p.id, 'approve', 409); // decided once
  });

  it('a super admin can propose but never approves or rejects their own; they can withdraw it; the history keeps every outcome', async () => {
    const own = await propose(sa1, { planRef: 'CHAIN' });
    expect((await c.http().post(`${ADMIN}/proposals/${own.id}/approve`).set(await sa1()).send({}).expect(403)).body.code).toBe('TWO_PERSON_RULE');
    expect((await c.http().post(`${ADMIN}/proposals/${own.id}/reject`).set(await sa1()).send({}).expect(403)).body.code).toBe('TWO_PERSON_RULE');
    await c.http().post(`${ADMIN}/proposals/${own.id}/withdraw`).set(await sa2()).send({}).expect(403); // only the proposer withdraws
    expect(fake.prices).toHaveLength(0);
    expect((await decide(sa1, own.id, 'withdraw')).status).toBe('WITHDRAWN');
    const other = await propose(ops, { planRef: 'CHAIN' });
    expect((await decide(sa2, other.id, 'reject', 200, 'too low')).status).toBe('REJECTED');
    const approved = await propose(ops, { planRef: 'PRO' });
    await decide(sa1, approved.id, 'approve');
    const hist = (await c.http().get(`${ADMIN}/proposals`).set(await ops()).expect(200)).body;
    expect(hist.map((x: any) => x.status).sort()).toEqual(['APPROVED', 'REJECTED', 'WITHDRAWN']);
    expect((await c.http().get(`${ADMIN}/proposals?status=REJECTED`).set(await ops()).expect(200)).body).toHaveLength(1);
  });

  it('the database keeps the history append-only and repeats the two-person rule', async () => {
    const p = await propose(ops);
    await decide(sa1, p.id, 'reject');
    await expect(c.prisma.kiorlyPlanPriceProposal.update({ where: { id: p.id }, data: { amount: '1.00' } })).rejects.toThrow(/append-only/);
    await expect(c.prisma.kiorlyPlanPriceProposal.delete({ where: { id: p.id } })).rejects.toThrow(/append-only/);
    const q = await propose(ops);
    await expect(c.prisma.kiorlyPlanPriceProposal.update({ where: { id: q.id }, data: { amount: '1.00' } })).rejects.toThrow(/only the decision/);
    await expect(c.prisma.kiorlyPlanPriceProposal.update({ where: { id: q.id }, data: { status: 'APPROVED', decidedBy: 'ops_1', decidedAt: new Date() } })).rejects.toThrow(/two_person/);
  });

  it('one open proposal per plan, market and period; a decided one frees the slot', async () => {
    const p = await propose(ops);
    expect((await propose(ops, { amount: '300' }, 409)).code).toBe('PROPOSAL_PENDING');
    await propose(ops, { interval: 'ANNUAL', amount: '2500' }); // another period is independent
    await decide(sa1, p.id, 'reject');
    await propose(ops, { amount: '300' });
  });

  it('warnings are advisory: an annual price at or below the monthly price is proposed and approved all the same, and the warning is on the record', async () => {
    fake.prices.push({ id: 'px_0', edition: 'PRO', marketCode: 'EG', interval: 'MONTHLY', currency: 'EGP', amount: '499.00', validFrom: '2026-01-01T00:00:00Z', validTo: null, priceVersion: 1, proposalId: null });
    const pv = (await c.http().post(`${ADMIN}/prices/preview`).set(await ops()).send(body({ interval: 'ANNUAL', amount: '399' })).expect(200)).body;
    expect(pv.warnings.map((w: any) => w.code)).toEqual(['ANNUAL_NOT_ABOVE_MONTHLY']);
    expect(pv.warnings[0].params).toMatchObject({ annual: '399.00', monthly: '499.00', currency: 'EGP' });
    const p = await propose(ops, { interval: 'ANNUAL', amount: '399' });
    expect(p.warnings.map((w: any) => w.code)).toEqual(['ANNUAL_NOT_ABOVE_MONTHLY']);
    expect((await decide(sa1, p.id, 'approve')).status).toBe('APPROVED');
    const ov = (await c.http().get(ADMIN).set(await sa1()).expect(200)).body;
    expect(ov.catalogueWarnings.map((w: any) => `${w.product}:${w.planKey}:${w.code}`)).toContain('PHARMACY:PRO:ANNUAL_NOT_ABOVE_MONTHLY'); // the Lab block reads the same in-memory stand-in
  });

  it('Clinic: a proposal publishes through the signed Clinic route only after approval, with the approval record; an unknown market and a missing plan are refused up front', async () => {
    await propose(ops, { product: 'CLINIC', planRef: 'pl_pro', marketCode: 'XX' }, 400);
    await propose(ops, { product: 'CLINIC', planRef: 'pl_nope' }, 400);
    const p = await propose(ops, { product: 'CLINIC', planRef: 'pl_pro', unit: 'PER_CLINICIAN', amount: '1299', includedClinicians: 1, validFrom: '2031-01-01T00:00:00Z' });
    expect(c.kiorly.planWrites.filter((w) => !w.body.preview)).toHaveLength(0);
    expect((await decide(sa1, p.id, 'approve')).status).toBe('APPROVED');
    const w = c.kiorly.planWrites.filter((x) => !x.body.preview).at(-1)!;
    expect(w.path).toBe('/plans/pl_pro/prices');
    expect(w.body).toMatchObject({ marketId: 'mk_EG', amount: '1299', unit: 'PER_CLINICIAN', validFrom: '2031-01-01T00:00:00.000Z', approval: { proposalId: p.id, proposedBy: 'ops_1' }, actor: { id: 'super_1' } });
    expect(c.kiorly.plansAdmin.plans[1].prices).toHaveLength(1);
  });

  it('Clinic: a retry after the publish already happened adopts the existing version instead of creating a second one', async () => {
    const p = await propose(ops, { product: 'CLINIC', planRef: 'pl_pro', amount: '1299', validFrom: '2031-01-01T00:00:00Z' });
    await c.prisma.kiorlyPlanPriceProposal.update({ where: { id: p.id }, data: { publishedValidFrom: new Date('2031-01-01T00:00:00Z') } });
    c.kiorly.plansAdmin.plans[1].prices.push({ id: 'pp_x', planId: 'pl_pro', marketId: 'mk_EG', currency: 'EGP', interval: 'MONTHLY', unit: 'PER_TENANT', amount: '1299.00', includedClinicians: 1, extraClinicianAmount: null, cohortKey: null, priceVersion: 4, validFrom: '2031-01-01T00:00:00.000Z', validTo: null });
    const a = await decide(sa1, p.id, 'approve');
    expect(a).toMatchObject({ status: 'APPROVED', publishedVersion: 4 });
    expect(c.kiorly.planWrites.filter((x) => !x.body.preview)).toHaveLength(0);
  });

  it('a refused or unreachable product leaves the proposal pending with the reason, and a retry works; Pharmacy publish is idempotent per proposal', async () => {
    const p = await propose(ops);
    fake.down = true;
    expect((await c.http().post(`${ADMIN}/proposals/${p.id}/approve`).set(await sa1()).send({}).expect(503)).body.code).toBe('PRODUCT_UNAVAILABLE');
    const pending = await c.prisma.kiorlyPlanPriceProposal.findUniqueOrThrow({ where: { id: p.id } });
    expect(pending).toMatchObject({ status: 'PENDING', lastError: expect.any(String) });
    expect(await c.prisma.auditLog.count({ where: { action: 'kiorly.plans.price_publish_refused', resourceId: p.id } })).toBe(1);
    fake.down = false;
    expect((await decide(sa2, p.id, 'approve')).status).toBe('APPROVED');
    expect(fake.prices).toHaveLength(1);
  });

  it('a start in the past moves to the approval time and the request is kept; input is validated', async () => {
    const p = await propose(ops, { validFrom: '2020-01-01T00:00:00Z' });
    const a = await decide(sa1, p.id, 'approve');
    expect(new Date(a.effectiveFrom).getTime()).toBeGreaterThan(Date.now() - 60_000);
    for (const bad of [{ amount: '-1' }, { amount: '1.234' }, { currency: 'EG' }, { interval: 'WEEKLY' }, { planRef: 'ENTERPRISE' }, { product: 'NURSE' }, { marketCode: 'EGY' }, { unit: 'PER_CLINICIAN' }]) await propose(ops, bad, 400);
    expect(await c.prisma.kiorlyPlanPriceProposal.count()).toBe(1);
  });

  it('the overview carries what the caller may do and the product price blocks; an unconfigured product connection is a clear state, not an error', async () => {
    const o = (await c.http().get(ADMIN).set(await ops()).expect(200)).body;
    expect(o.capabilities).toEqual({ canPropose: true, canApprove: false, you: 'ops_1' });
    expect(o.pharmacy).toMatchObject({ available: true, configured: true, editions: ['LITE', 'PRO', 'CHAIN'] });
    expect((await c.http().get(ADMIN).set(await sa1()).expect(200)).body.capabilities.canApprove).toBe(true);
    jest.spyOn(c.app.get(ProductPlansClient), 'configured').mockReturnValue(false);
    jest.spyOn(c.app.get(ProductPlansClient), 'overview').mockRestore();
    const off = (await c.http().get(ADMIN).set(await ops()).expect(200)).body;
    expect(off.lab).toMatchObject({ available: false, configured: false, code: 'PRODUCT_PRICES_NOT_CONFIGURED' });
  });

  it('the public API never shows a Pharmacy or Lab price that is not in force yet or is not for the asked market', async () => {
    fake.prices.push({ id: 'px_f', edition: 'PRO', marketCode: 'EG', interval: 'MONTHLY', currency: 'EGP', amount: '10.00', validFrom: '2099-01-01T00:00:00Z', validTo: null, priceVersion: 1, proposalId: null });
    fake.prices.push({ id: 'px_s', edition: 'CHAIN', marketCode: 'SA', interval: 'MONTHLY', currency: 'SAR', amount: '20.00', validFrom: '2026-01-01T00:00:00Z', validTo: null, priceVersion: 1, proposalId: null });
    svc.invalidate();
    const r = (await c.http().get(PUBLIC).expect(200)).body;
    for (const id of ['pharmacy', 'lab']) for (const p of r.modules.find((m: any) => m.id === id).plans) expect(p.priceStatus).toBe('TO_BE_ANNOUNCED');
  });
});
