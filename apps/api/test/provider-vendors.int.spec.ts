import { createCtx, TestCtx } from './harness';
import { signMetaBody } from '../src/common/providers/vendors/meta-whatsapp';
import { paymobHmac } from '../src/common/providers/vendors/paymob';
import { fawryCallbackSignature } from '../src/common/providers/vendors/fawry';

/** Native vendor webhooks through the real HTTP stack: Meta handshake + signed delivery statuses, Paymob HMAC (query), Fawry signature, health mode report. */
describe('native provider vendors over HTTP', () => {
  let c: TestCtx;
  const set = (v: Record<string, string>) => Object.assign(process.env, v);
  const unset = (v: Record<string, string>) => Object.keys(v).forEach((k) => delete process.env[k]);
  const META = { WHATSAPP_MODE: 'real', WHATSAPP_PROVIDER: 'meta', WHATSAPP_API_KEY: 'EAAG', WHATSAPP_SENDER_ID: '1055550001', WHATSAPP_WEBHOOK_SECRET: 'meta_app_secret_0123456789', WHATSAPP_VERIFY_TOKEN: 'verify_me_123' };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); });

  it('GET /health/providers reports modes without secrets', async () => {
    set(META);
    try {
      const r = await c.http().get('/api/v1/health/providers').expect(200);
      expect(r.body.providers.find((p: any) => p.provider === 'whatsapp')).toEqual({ provider: 'whatsapp', mode: 'real', vendor: 'meta', ready: true });
      expect(JSON.stringify(r.body)).not.toContain('EAAG');
      const ready = await c.http().get('/api/v1/health/ready').expect(200);
      expect(Array.isArray(ready.body.providers)).toBe(true);
    } finally { unset(META); }
  });

  it('Meta: hub.challenge handshake, signature required, delivery status applied once and forward-only', async () => {
    set(META);
    try {
      await c.http().get('/api/v1/messaging/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify_me_123&hub.challenge=987').expect(200).expect('987');
      await c.http().get('/api/v1/messaging/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1').expect(403);
      const prisma = c.prisma;
      await prisma.messageLog.create({ data: { channel: 'WHATSAPP', direction: 'OUT', mode: 'real', recipientMasked: '+201****567', templateId: 'T', locale: 'en', status: 'SENT', providerRef: 'wamid.INT1' } });
      const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.INT1', status: 'delivered', timestamp: '1700000000' }] } }] }] });
      await c.http().post('/api/v1/messaging/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', 'sha256=bad').send(body).expect(401);
      const sig = signMetaBody(META.WHATSAPP_WEBHOOK_SECRET, body);
      const a = await c.http().post('/api/v1/messaging/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', sig).send(body).expect(200);
      expect(a.body).toEqual({ applied: 1, ignored: 0 });
      const b = await c.http().post('/api/v1/messaging/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', sig).send(body).expect(200);
      expect(b.body).toEqual({ applied: 0, ignored: 1 }); // replay is a no-op
      expect((await prisma.messageLog.findFirst({ where: { providerRef: 'wamid.INT1' } }))!.status).toBe('DELIVERED');
    } finally { unset(META); }
  });

  it('Paymob / Fawry: forged callbacks are rejected, nothing is captured', async () => {
    const V = { PAYMENT_MODE: 'real', PAYMENT_PROVIDER: 'vendor', PAYMENT_ENABLED_PSPS: 'paymob,fawry', PAYMOB_SECRET_KEY: 'sk', PAYMOB_PUBLIC_KEY: 'pk', PAYMOB_HMAC_SECRET: 'paymob_int_secret', PAYMOB_INTEGRATION_IDS: '1', FAWRY_MERCHANT_CODE: 'MC', FAWRY_SECURE_KEY: 'fawry_int_key' };
    set(V);
    try {
      const obj = { amount_cents: 100, created_at: '2026-11-23T10:00:00', currency: 'EGP', id: 1, order: { id: 9, merchant_order_id: 'pay_nope' }, success: true, pending: false, source_data: {} };
      const raw = JSON.stringify({ type: 'TRANSACTION', obj });
      await c.http().post('/api/v1/pay/webhooks/paymob?hmac=deadbeef').set('content-type', 'application/json').send(raw).expect(400);
      await c.http().post(`/api/v1/pay/webhooks/paymob?hmac=${paymobHmac('paymob_int_secret', obj)}`).set('content-type', 'application/json').send(raw).expect(404); // signature accepted (not 400); the payment id is unknown so the domain layer answers PAYMENT_NOT_FOUND
      const cb = { fawryRefNumber: '1', merchantRefNumber: 'pay_nope', paymentAmount: 1, orderAmount: 1, orderStatus: 'PAID', paymentMethod: 'CARD', paymentRefrenceNumber: 'x' };
      await c.http().post('/api/v1/pay/webhooks/fawry').set('content-type', 'application/json').send(JSON.stringify({ ...cb, messageSignature: 'bad' })).expect(400);
      await c.http().post('/api/v1/pay/webhooks/fawry').set('content-type', 'application/json').send(JSON.stringify({ ...cb, messageSignature: fawryCallbackSignature('fawry_int_key', cb) })).expect(404);
    } finally { unset(V); }
  });
});
