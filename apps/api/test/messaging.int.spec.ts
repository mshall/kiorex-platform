import { createCtx, TestCtx } from './harness';
import { EngagementService } from '../src/engagement/engagement-public';
import { MessagingHub } from '../src/messaging/messaging-public';

describe('unified messaging (mock adapters, dev inbox, ops view)', () => {
  let c: TestCtx; let admin: { Authorization: string }; let auth: { Authorization: string };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    admin = await c.as('adm1', { roles: ['ops_admin'] });
    auth = await c.as('sub_amira');
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy', email: 'amira@example.test' }).expect(200);
    await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
  });
  afterAll(() => { delete process.env.QUIET_HOURS_START; delete process.env.QUIET_HOURS_END; });
  const notify = (channels: string[], key: string) => c.get(EngagementService).notify('sub_amira', { kind: 'BOOKING_CONFIRMED', params: { doctor: 'Dr X', time: 'T' }, dedupeKey: key, channels });

  it('each channel (email, whatsapp, sms, push) writes to the DB log in mock mode with SENT state', async () => {
    await notify(['WHATSAPP', 'SMS', 'PUSH', 'EMAIL'], 'm1');
    const out = await c.http().get('/api/v1/dev/messaging/outbox').expect(200);
    expect(out.body.items.map((m: any) => m.channel).sort()).toEqual(['EMAIL', 'PUSH', 'SMS', 'WHATSAPP']);
    expect(out.body.items.every((m: any) => m.status === 'SENT' && m.mode === 'mock' && m.templateId.startsWith('TODO_NEEDS_HUMAN_'))).toBe(true);
    const wa = out.body.items.find((m: any) => m.channel === 'WHATSAPP');
    expect(wa.recipient).toBe('+201000000001');
    expect(wa.body).toContain('Dr X');
  });

  it('delivery-state simulation: SENT -> DELIVERED (tick) -> READ; bounce -> FAILED; states only move forward', async () => {
    await notify(['WHATSAPP'], 'm2');
    expect((await c.http().post('/api/v1/dev/messaging/delivery-tick').expect(200)).body.delivered).toBe(1);
    const log = await c.http().get('/api/v1/admin/messaging/log?channel=WHATSAPP').set(admin).expect(200);
    expect(log.body.items[0]).toMatchObject({ status: 'DELIVERED', recipientMasked: expect.stringContaining('****') });
    expect(log.body.items[0].recipient).toBeUndefined(); // ops view never shows raw recipients
    const id = log.body.items[0].id;
    expect((await c.http().post(`/api/v1/admin/messaging/log/${id}/simulate`).set(admin).send({ state: 'READ' }).expect(200)).body.status).toBe('READ');
    expect((await c.http().post(`/api/v1/admin/messaging/log/${id}/simulate`).set(admin).send({ state: 'DELIVERED' }).expect(200)).body.status).toBe('READ');
    await c.prisma.patientProfile.update({ where: { sub: 'sub_amira' }, data: { phone: '+201000000000' } }); // ends with 0000: simulated bounce
    await notify(['SMS'], 'm3');
    const sms = (await c.http().get('/api/v1/admin/messaging/log?channel=SMS').set(admin)).body.items[0];
    expect(sms).toMatchObject({ status: 'FAILED', error: 'MOCK_BOUNCE' });
    expect((await c.prisma.message.findFirstOrThrow({ where: { channel: 'SMS' } })).status).toBe('FAILED');
    expect((await c.http().get('/api/v1/admin/messaging/stats').set(admin)).body.mode).toBe('mock');
    await c.http().get('/api/v1/admin/messaging/log').set(auth).expect(403);
  });

  it('inbound dev messages are logged as RECEIVED and dev routes 404 outside mock/dev mode', async () => {
    const r = await c.http().post('/api/v1/dev/messaging/inbound').send({ channel: 'SMS', from: '+201111111111', text: 'hello' }).expect(200);
    expect(r.body.replies).toEqual([]);
    expect((await c.prisma.messageLog.findFirstOrThrow({ where: { direction: 'IN' } })).status).toBe('RECEIVED');
    process.env.MESSAGING_MODE = 'real';
    try { await c.http().get('/api/v1/dev/messaging/outbox').expect(404); } finally { delete process.env.MESSAGING_MODE; }
  });

  it('real mode without a configured provider fails closed (NEEDS_HUMAN) and keeps no body/recipient in the log', async () => {
    process.env.MESSAGING_MODE = 'real';
    try {
      const m = await c.get(MessagingHub).send({ channel: 'EMAIL', to: 'x@example.test', templateId: 'TODO_NEEDS_HUMAN_x', locale: 'en', body: 'secret body' });
      expect(m.ok).toBe(false);
      expect(m.error).toContain('NEEDS_HUMAN');
      expect(m.body).toBeNull(); expect(m.recipient).toBeNull(); expect(m.recipientMasked).toMatch(/\*\*\*/);
    } finally { delete process.env.MESSAGING_MODE; }
  });
});
