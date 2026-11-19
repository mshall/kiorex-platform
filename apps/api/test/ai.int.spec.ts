import { createCtx, TestCtx } from './harness';
import { AiGatewayService, AiProvider } from '../src/ai-gateway/ai-gateway-public';

describe('AI gateway (KX-11) symptom → specialty navigation', () => {
  let c: TestCtx;
  let auth: { Authorization: string };
  let seen: string[];
  const spy: AiProvider = { name: 'spy', classify: async (t) => { seen.push(t); return ['cardiology']; } };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset(); seen = [];
    auth = await c.as('sub_amira');
    c.get(AiGatewayService).setProvider(spy);
  });
  const nav = (text: string) => c.http().post('/api/v1/navigation/symptoms').set(auth).send({ text }).expect(200);
  const enable = async () => {
    await c.http().put('/api/v1/admin/flags/kiorex.ai_navigation/gate').set(await c.as('a', { roles: ['super_admin'] })).send({ gateId: 'TEST', approver: 'fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/g' }).expect(200);
  };

  it('not effective (launch-locked, no gate): rules fallback, provider never called', async () => {
    const r = await nav('my heart races');
    expect(r.body).toMatchObject({ source: 'RULES', ai: false });
    expect(r.body.fallbackReason).toBe('FLAG_AWAITING_GATE');
    expect(r.body.label).toBeUndefined();
    expect(seen).toHaveLength(0);
  });

  it('effective but no AI_PROCESSING consent: rules fallback', async () => {
    await enable();
    expect((await nav('chest tightness when i walk fast, heart')).body.fallbackReason).toBe('NO_AI_CONSENT');
    expect(seen).toHaveLength(0);
  });

  it('effective + consent: provider used, PHI redacted BEFORE the call, output labelled, usage metered, quota enforced', async () => {
    await enable();
    await c.http().put('/api/v1/me/consents/AI_PROCESSING').set(auth).send({ granted: true });
    const r = await nav('call me 01012345678 or a.b@mail.com my id 29004020101234, heart palpitations');
    expect(r.body).toMatchObject({ source: 'AI', ai: true });
    expect(r.body.label.badge).toBe('AI');
    expect(r.body.specialties[0].code).toBe('cardiology');
    expect(seen[0]).not.toMatch(/01012345678|a\.b@mail|29004020101234/);
    expect(seen[0]).toContain('[PHONE]');
    const u = await c.prisma.aiUsage.findFirstOrThrow();
    expect(u).toMatchObject({ source: 'AI', provider: 'spy', redactions: 3 });
    process.env.AI_DAILY_QUOTA = '1';
    try { expect((await nav('heart')).body.fallbackReason).toBe('QUOTA_EXCEEDED'); } finally { delete process.env.AI_DAILY_QUOTA; }
  });

  it('emergency text short-circuits before any flag, consent or provider call', async () => {
    await enable();
    await c.http().put('/api/v1/me/consents/AI_PROCESSING').set(auth).send({ granted: true });
    const r = await nav('I have severe chest pain');
    expect(r.body.emergency).toMatchObject({ number: '123', bookingBlocked: true });
    expect(seen).toHaveLength(0);
  });

  it('provider failure degrades to rules; model output is constrained to known specialty codes', async () => {
    await enable();
    await c.http().put('/api/v1/me/consents/AI_PROCESSING').set(auth).send({ granted: true });
    c.get(AiGatewayService).setProvider({ name: 'boom', classify: async () => { throw new Error('down'); } });
    expect((await nav('tooth pain')).body).toMatchObject({ source: 'RULES', fallbackReason: 'PROVIDER_ERROR' });
  });

  it('default fake provider is deterministic', async () => {
    c.get(AiGatewayService).setProvider(undefined as any);
    await enable();
    await c.http().put('/api/v1/me/consents/AI_PROCESSING').set(auth).send({ granted: true });
    const a = (await nav('skin rash and itch')).body;
    expect(a.source).toBe('AI');
    expect(a.specialties[0].code).toBe('dermatology');
  });
});
