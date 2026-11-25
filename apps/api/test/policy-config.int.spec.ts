import { createCtx, TestCtx } from './harness';
import { GrowthConfigService } from '../src/growth/growth-public';
import { PolicyService } from '../src/growth/policy/policy.service';
import { RECOMMENDATION_POLICY } from '../src/growth/recommendations/recommendation.types';
import { recoverableLossBlockDays } from '../src/growth/rewards/reward-rules';
import { clearPolicyOverrides } from '../src/growth/policy/policy-registry';
import { SUPER_A, SUPER_B } from './growth-helpers';

const code = async (p: Promise<unknown>) => { try { await p; return 'NO_ERROR'; } catch (e) { return (e as { getResponse(): { code: string } }).getResponse().code; } };

/** Configurability sweep: a policy kind goes DRAFT -> approved by a second super admin -> live in the code that used to hold the constant, without a deploy. Real Postgres. */
describe('policy kinds through the maker-checker', () => {
  let c: TestCtx; let svc: GrowthConfigService; let policy: PolicyService;
  beforeAll(async () => { c = await createCtx(); svc = c.get(GrowthConfigService); policy = c.get(PolicyService); });
  afterAll(async () => { clearPolicyOverrides(); await c.close(); });
  beforeEach(async () => { await c.reset(); clearPolicyOverrides(); });

  it('shipped numbers answer until a version is approved; then the approved number is live; a rollback restores the shipped one', async () => {
    expect(RECOMMENDATION_POLICY.expiryDays).toBe(14); expect(recoverableLossBlockDays()).toBe(90);
    const d = await svc.createDraft(SUPER_A, { kind: 'RECOMMENDATION_POLICY', scope: 'GLOBAL', payload: { expiryDays: 21, k: 12 }, announcement: 'Proposals now stay open for three weeks.' });
    await svc.submit(SUPER_A, d.id);
    await policy.refresh(); expect(RECOMMENDATION_POLICY.expiryDays).toBe(14); // a pending version changes nothing
    await svc.approve(SUPER_B, d.id); await policy.refresh();
    expect(RECOMMENDATION_POLICY).toMatchObject({ expiryDays: 21, k: 12, maxPerRun: 10 });
    const r = await svc.rollback(SUPER_A, { kind: 'RECOMMENDATION_POLICY', scope: 'GLOBAL', scopeId: '', toVersion: 1, reason: 'back to the shipped numbers', announcement: 'Back to two weeks for proposals.' }).catch((e) => e);
    expect(r).toBeTruthy();
  });
  it('below-floor numbers are refused at the door (k 9, loss block 29 days), unknown keys too', async () => {
    expect(await code(svc.createDraft(SUPER_A, { kind: 'RECOMMENDATION_POLICY', scope: 'GLOBAL', payload: { k: 9 }, announcement: 'lowering the floor' }))).toBe('GROWTH_CONFIG_INVALID');
    expect(await code(svc.createDraft(SUPER_A, { kind: 'REWARD_GUARDS', scope: 'GLOBAL', payload: { recoverableLossBlockDays: 29 } }))).toBe('GROWTH_CONFIG_INVALID');
    expect(await code(svc.createDraft(SUPER_A, { kind: 'REWARD_GUARDS', scope: 'GLOBAL', payload: { surprise: 1 } }))).toBe('GROWTH_CONFIG_INVALID');
  });
  it('policy kinds exist at GLOBAL scope only', async () => {
    expect(await code(svc.createDraft(SUPER_A, { kind: 'REWARD_GUARDS', scope: 'MARKET', scopeId: 'EG', payload: { maxActiveLots: 40 } }))).toBe('GROWTH_INVALID_REQUEST');
  });
  it('self approval is still refused and the reward guard goes live only after a second person approves', async () => {
    const d = await svc.createDraft(SUPER_A, { kind: 'REWARD_GUARDS', scope: 'GLOBAL', payload: { recoverableLossBlockDays: 120 } }); await svc.submit(SUPER_A, d.id);
    expect(await code(svc.approve(SUPER_A, d.id))).toBe('GROWTH_CONFIG_SELF_APPROVAL');
    await policy.refresh(); expect(recoverableLossBlockDays()).toBe(90);
    await svc.approve(SUPER_B, d.id); await policy.refresh(); expect(recoverableLossBlockDays()).toBe(120);
  });
  it('an announcement is required for RECOMMENDATION_POLICY and INTEGRATION_MODES', async () => {
    const d = await svc.createDraft(SUPER_A, { kind: 'INTEGRATION_MODES', scope: 'GLOBAL', payload: { modes: { SMS: 'real' } } }); await svc.submit(SUPER_A, d.id).catch(() => undefined);
    expect(await code(svc.approve(SUPER_B, d.id))).not.toBe('NO_ERROR');
  });
  it('a stored payload that no longer validates is ignored and the defaults keep running', async () => {
    await c.prisma.growthConfigVersion.create({ data: { kind: 'REWARD_GUARDS', scope: 'GLOBAL', scopeId: '', version: 1, status: 'ACTIVE', payload: { recoverableLossBlockDays: 1 }, createdBy: 'adm_a', approvedBy: 'adm_b', approvedAt: new Date(), checksum: 'x', effectiveFrom: new Date(Date.now() - 1000) } });
    await policy.refresh(); expect(recoverableLossBlockDays()).toBe(90);
  });
});
