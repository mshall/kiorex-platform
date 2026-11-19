import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { signWebhook, verifyKiorlyRequest } from '@kiorex/contracts';

export type PartnerKind = 'pharmacy' | 'lab';
const CFG = {
  pharmacy: { base: '/pharmacy/v1', key: 'kx_dev_pharmacy_client', secret: 'kx_dev_pharmacy_secret_change_me', webhookSecret: 'kx_dev_pharmacy_webhook_secret', env: 'KIORLY_PHARMACY_BASE_URL', webhookPath: '/api/v1/webhooks/pharmacy' },
  lab: { base: '/lab/v1', key: 'kx_dev_lab_client', secret: 'kx_dev_lab_secret_change_me', webhookSecret: 'kx_dev_lab_webhook_secret', env: 'KIORLY_LAB_BASE_URL', webhookPath: '/api/v1/webhooks/lab' },
} as const;

/** In-process fake of the DRAFT Kiorly Pharmacy / Kiorly Lab operational APIs (not built yet). Verifies HMAC on every request. */
export class FakePartner {
  server!: Server;
  port = 0;
  calls: { method: string; path: string; body: any; headers: Record<string, any> }[] = [];
  orders = new Map<string, any>();
  orderMode: undefined | 'reject' | '5xx' | 'timeout';
  rxMode: 'VALID' | 'INVALID' | 'PENDING' = 'VALID';
  cancelMode: undefined | '409';
  slots: { startsAt: string; endsAt: string }[] = [];
  bad = 0;
  readonly catalogue = [
    { pharmacyId: 'ph_1', sku: 'PARA500', name: 'Paracetamol 500mg', strength: '500mg', form: 'tablet', priceMinor: 2500, rxRequired: false, controlled: false, available: true },
    { pharmacyId: 'ph_1', sku: 'AMOX500', name: 'Amoxicillin 500mg', strength: '500mg', form: 'capsule', priceMinor: 8000, rxRequired: true, controlled: false, available: true },
    { pharmacyId: 'ph_1', sku: 'CTRL1', name: 'Controlled substance', priceMinor: 9999, rxRequired: true, controlled: true, available: true },
    { pharmacyId: 'ph_1', sku: 'OUT1', name: 'Out of stock item', priceMinor: 1000, rxRequired: false, controlled: false, available: false },
  ];
  readonly labTests = [
    { labId: 'lab_1', labName: 'Nile Lab', code: 'CBC', name: 'Complete blood count', priceMinor: 15000, sampleType: 'blood', homeCollection: true },
    { labId: 'lab_1', labName: 'Nile Lab', code: 'TSH', name: 'Thyroid stimulating hormone', priceMinor: 20000, sampleType: 'blood', homeCollection: true },
  ];

  constructor(public readonly kind: PartnerKind) {}
  get cfg() { return CFG[this.kind]; }
  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as any).port;
    process.env[this.cfg.env] = `http://127.0.0.1:${this.port}${this.cfg.base}`;
    return this;
  }
  async stop() { await new Promise((r) => this.server.close(r)); }
  reset() { this.calls = []; this.orders.clear(); this.orderMode = undefined; this.rxMode = 'VALID'; this.cancelMode = undefined; this.slots = []; this.bad = 0; }
  callsTo(method: string, part: string) { return this.calls.filter((c) => c.method === method && c.path.includes(part)); }

  /** Body + headers of a partner -> Kiorex outbox webhook, signed with the partner webhook secret. */
  event(type: string, data: Record<string, unknown>, o: { eventId?: string; aggregateId?: string } = {}) {
    const body = JSON.stringify({ eventId: o.eventId ?? `pev_${Math.random().toString(36).slice(2)}`, type, aggregateType: type.startsWith('Lab') ? 'LabReport' : 'PharmacyOrder', aggregateId: o.aggregateId ?? String(data.orderId), target: 'KIOREX', occurredAt: new Date().toISOString(), data });
    const s = signWebhook({ secret: this.cfg.webhookSecret, body, eventType: type });
    return { path: this.cfg.webhookPath, headers: { ...s.headers, 'content-type': 'application/json' }, body };
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url!, 'http://x');
    const v = verifyKiorlyRequest({ headers: req.headers as any, method: req.method!, path: url.pathname, body: raw, secret: this.cfg.secret });
    const send = (s: number, b: any) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (!v.ok || req.headers['x-kiorly-client-key'] !== this.cfg.key) { this.bad++; return send(401, { code: 'BAD_HMAC' }); }
    const path = url.pathname.replace(this.cfg.base, '');
    const body = raw.length ? JSON.parse(raw.toString()) : undefined;
    this.calls.push({ method: req.method!, path, body, headers: req.headers });
    const m = req.method!;
    const hang = () => new Promise<void>(() => undefined);

    if (this.kind === 'pharmacy') {
      if (m === 'GET' && path === '/pharmacies') return send(200, { items: [{ id: 'ph_1', name: 'Nile Pharmacy', delivery: { enabled: true, feeMinor: 3000, radiusKm: 8 }, pickup: true, prepMinutes: 20 }, { id: 'ph_2', name: 'Pickup Only', delivery: { enabled: false, feeMinor: 0 }, pickup: true }] });
      if (m === 'GET' && path === '/catalogue') { const q = (url.searchParams.get('q') ?? '').toLowerCase(); return send(200, { items: this.catalogue.filter((i) => !q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)) }); }
      if (m === 'POST' && path === '/catalogue/quote') {
        const items = body.items.map((l: any) => { const c = this.catalogue.find((x) => x.sku === l.sku); return c ? { sku: c.sku, name: c.name, qty: l.qty, unitPriceMinor: c.priceMinor, rxRequired: c.rxRequired, controlled: c.controlled, available: c.available } : { sku: l.sku, name: 'unknown', qty: l.qty, unitPriceMinor: 0, rxRequired: false, controlled: false, available: false }; });
        return send(200, { items, delivery: { feeMinor: body.delivery?.method === 'DELIVERY' ? 3000 : 0 } });
      }
      if (m === 'POST' && path === '/orders') {
        const key = req.headers['idempotency-key'] as string;
        if (this.orders.has(key)) return send(200, this.orders.get(key));
        if (this.orderMode === 'timeout') return hang();
        if (this.orderMode === '5xx') return send(503, {});
        const o = { orderId: `pho_${this.orders.size + 1}`, status: this.orderMode === 'reject' ? 'REJECTED' : body.prescription ? 'PENDING_VALIDATION' : 'ACCEPTED', reason: this.orderMode === 'reject' ? 'OUT_OF_STOCK' : undefined, _body: body };
        this.orders.set(key, o);
        return send(201, { orderId: o.orderId, status: o.status, reason: o.reason });
      }
      if (m === 'POST' && path === '/prescriptions/validate') return send(200, { status: this.rxMode, reason: this.rxMode === 'INVALID' ? 'PRESCRIBER_NOT_VERIFIED' : undefined });
      if (m === 'POST' && /^\/orders\/[^/]+\/cancel$/.test(path)) return this.cancelMode === '409' ? send(409, { code: 'ALREADY_PREPARING' }) : send(200, { status: 'CANCELLED' });
    } else {
      if (m === 'GET' && path === '/tests') { const q = (url.searchParams.get('q') ?? '').toLowerCase(); return send(200, { items: this.labTests.filter((t) => !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase() === q) }); }
      if (m === 'POST' && path === '/tests/quote') return send(200, { tests: body.testCodes.map((c: string) => this.labTests.find((t) => t.code === c)).filter(Boolean).map((t: any) => ({ code: t.code, name: t.name, priceMinor: t.priceMinor })), collectionFeeMinor: body.collectionType === 'HOME' ? 5000 : 0 });
      if (m === 'GET' && /^\/labs\/[^/]+\/slots$/.test(path)) { const f = new Date(url.searchParams.get('from')!).getTime(), t = new Date(url.searchParams.get('to')!).getTime(); return send(200, { slots: this.slots.filter((s) => new Date(s.startsAt).getTime() >= f && new Date(s.startsAt).getTime() <= t) }); }
      if (m === 'POST' && path === '/orders') {
        const key = req.headers['idempotency-key'] as string;
        if (this.orders.has(key)) return send(200, this.orders.get(key));
        if (this.orderMode === '5xx') return send(503, {});
        const o = { orderId: `lbo_${this.orders.size + 1}`, status: this.orderMode === 'reject' ? 'REJECTED' : 'ACCEPTED', reason: this.orderMode === 'reject' ? 'NO_CAPACITY' : undefined };
        this.orders.set(key, o);
        return send(201, o);
      }
      if (m === 'POST' && /^\/orders\/[^/]+\/cancel$/.test(path)) return this.cancelMode === '409' ? send(409, { code: 'ALREADY_COLLECTED' }) : send(200, { status: 'CANCELLED' });
    }
    return send(404, { message: `no route ${m} ${path}` });
  }
}
