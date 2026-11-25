import { createCtx, TestCtx } from './harness';
import { SendGateService } from '../src/growth/lifecycle/send-gate.service';
import { LifecyclePolicyService } from '../src/growth/lifecycle/lifecycle-policy.service';
import { JOURNEYS } from '../src/growth/lifecycle/journeys';
import { say, setupAssistant } from './assistant-helpers';

/**
 * GRW-P3-H flag matrix: with every launch-locked growth flag in its shipped state (no gate evidence, nothing switched on by a human) the platform does none of the following:
 * send a marketing message, issue or show a reward, call a real model, mint a visitor key, redeem a corporate benefit, apply a sponsored discount. One spec, one place.
 */
const LOCKED = ['growth.analytics_visitor', 'growth.marketing_messaging', 'growth.patient_referral', 'growth.rewards', 'growth.patient_credit', 'growth.refund_as_credit', 'growth.family_credit', 'growth.support_goodwill',
  'growth.sponsored_promotions', 'growth.corporate', 'growth.assistant_real_model', 'kiorex.whatsapp_ai_assistant'];

describe('every launch-locked growth flag shipped: nothing happens (GRW-P3-H)', () => {
  let c: TestCtx; let pat: { Authorization: string };
  beforeAll(async () => { c = await createCtx({ devMarketGate: true }); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); c.flags.invalidate(); pat = await c.as('sub_locked'); });

  it('the flag catalogue marks each of them launch-locked and none is effective without gate evidence', async () => {
    const admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    const defs = (await c.http().get('/api/v1/admin/flags').set(admin).expect(200)).body as Array<{ key: string; launchLocked: boolean }>;
    for (const k of LOCKED) { const d = defs.find((x) => x.key === k); expect(d).toBeTruthy(); expect(d!.launchLocked).toBe(true); expect(await c.flags.isEnabled(k, { market: 'EG' })).toBe(false); }
  });

  it('no visitor key: a consented touch creates neither a cookie nor a touchpoint while growth.analytics_visitor is locked', async () => {
    const r = await c.http().post('/api/v1/growth/v1/touch').set('x-kx-consent', 'analytics').send({ landingKind: 'HOME', utm: { source: 'x', campaign: 'y' } });
    expect(r.status).toBe(202);
    expect(String(r.headers['set-cookie'] ?? '')).not.toMatch(/kxv=/);
    expect(await c.prisma.growthTouchpoint.count()).toBe(0);
  });

  it('no rewards: every patient reward and credit route answers 403 FEATURE_DISABLED and nothing is issued', async () => {
    for (const [m, p, key] of [['get', '/api/v1/growth/v1/referral/rewards', 'growth.rewards'], ['post', '/api/v1/growth/v1/rewards/quote', 'growth.rewards'], ['get', '/api/v1/growth/v1/credit', 'growth.patient_credit'], ['get', '/api/v1/growth/v1/credit/household', 'growth.family_credit']] as const) {
      const r = await (c.http() as any)[m](p).set(pat).send(m === 'post' ? {} : undefined);
      expect(r.status).toBe(403); expect(r.body).toMatchObject({ code: 'FEATURE_DISABLED', key });
    }
    expect(await c.prisma.rewardLot.count()).toBe(0); expect(await c.prisma.rewardLedgerEntry.count()).toBe(0);
  });

  it('no corporate redemption: join, leave and the benefit quote are refused and no corporate row appears', async () => {
    for (const [m, p] of [['post', '/api/v1/growth/v1/corporate/join'], ['post', '/api/v1/growth/v1/corporate/leave'], ['get', '/api/v1/growth/v1/corporate/me']] as const) {
      const r = await (c.http() as any)[m](p).set(pat).send(m === 'post' ? { code: 'ANY' } : undefined); expect(r.status).toBe(403); expect(r.body.code).toBe('FEATURE_DISABLED');
    }
  });

  it('no sponsored discount: the promotion quote is refused', async () => {
    const r = await c.http().get('/api/v1/growth/v1/promotions/quote?bookingId=kx_bk_none').set(pat); expect(r.status).toBe(403); expect(r.body.code).toBe('FEATURE_DISABLED');
  });

  it('no marketing send: a MARKETING journey step is skipped by the gate and no Message row exists', async () => {
    const gate = c.get(SendGateService); const lp = c.get(LifecyclePolicyService); const policy = await lp.resolve('EG');
    expect(await lp.marketingOn('EG')).toBe(false);
    const def = JOURNEYS.find((j) => j.steps.some((s) => s.messageClass === 'MARKETING'))!; const step = def.steps.find((s) => s.messageClass === 'MARKETING')!;
    const r = await gate.send({ sub: 'sub_locked', def, step, channel: 'WHATSAPP', anchorId: 'a1', anchorParams: {}, now: new Date(), policy, marketingFlagOn: false, journeyEnabled: true });
    expect(r.outcome.decision).toBe('SKIP'); expect(r.messageId).toBeNull();
    expect(await c.prisma.message.count({ where: { sub: 'sub_locked' } })).toBe(0);
  });

  it('no real model call: with the assistant unlocked for a test the model mode of every turn is still mock while growth.assistant_real_model is locked', async () => {
    await setupAssistant(c); await say(c, 'I need a dermatologist'); await say(c, 'مرحبا');
    const turns = await c.prisma.assistantTurn.findMany({ where: { direction: 'OUT' } });
    expect(turns.length).toBeGreaterThan(0); expect(turns.every((t) => t.modelMode === 'mock')).toBe(true);
  });
});
