import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { PARTNER_API_PATH, PARTNER_DEV_DEFAULTS, PARTNER_WEBHOOK_PATH, signWebhook, verifyKiorlyRequest } from '@kiorex/contracts';

export type PartnerKind = 'pharmacy' | 'lab';
/** Shapes and paths mirror the REAL Kiorly Pharmacy / Lab APIs (kiorex-contracts 1.4.0 PARTNER_API_PATH / PARTNER_DEV_DEFAULTS). */
const CFG = {
  pharmacy: { base: PARTNER_API_PATH.pharmacy, ...PARTNER_DEV_DEFAULTS.pharmacy, env: 'KIORLY_PHARMACY_BASE_URL', webhookPath: PARTNER_WEBHOOK_PATH.pharmacy },
  lab: { base: PARTNER_API_PATH.lab, ...PARTNER_DEV_DEFAULTS.lab, env: 'KIORLY_LAB_BASE_URL', webhookPath: PARTNER_WEBHOOK_PATH.lab },
} as const;

/** In-process fake of the Kiorly Pharmacy / Kiorly Lab APIs (contract-faithful; the REAL services are exercised by e2e/). Verifies HMAC on every request. */
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
    process.env[this.cfg.env] = `http://127.0.0.1:${this.port}`; // host only: the client appends the contract path
    return this;
  }
  async stop() { await new Promise((r) => this.server.close(r)); }
  reset() { this.calls = []; this.orders.clear(); this.orderMode = undefined; this.rxMode = 'VALID'; this.cancelMode = undefined; this.slots = []; this.bad = 0; }
  callsTo(method: string, part: string) { return this.calls.filter((c) => c.method === method && c.path.includes(part)); }

  /** Body + headers of a partner -> Kiorex outbox webhook, signed with the partner webhook secret. */
  event(type: string, data: Record<string, unknown>, o: { eventId?: string; aggregateId?: string } = {}) {
    const body = JSON.stringify({ eventId: o.eventId ?? `pev_${Math.random().toString(36).slice(2)}`, type, aggregateType: type.startsWith('Lab') ? 'LabReport' : 'PharmacyOrder', aggregateId: o.aggregateId ?? String(data.orderId), target: 'KIOREX', occurredAt: new Date().toISOString(), data });
    const s = signWebhook({ secret: this.cfg.webhookSecret, body, eventType: type, clientKey: this.cfg.clientKey });
    return { path: this.cfg.webhookPath, headers: { ...s.headers, 'content-type': 'application/json' }, body };
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url!, 'http://x');
    const v = verifyKiorlyRequest({ headers: req.headers as any, method: req.method!, path: url.pathname, body: raw, secret: this.cfg.clientSecret });
    const send = (s: number, b: any) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (!v.ok || req.headers['x-kiorly-client-key'] !== this.cfg.clientKey) { this.bad++; return send(401, { code: 'BAD_HMAC' }); }
    const path = url.pathname.replace(this.cfg.base, '');
    if (!url.pathname.startsWith(this.cfg.base)) { this.bad++; return send(404, { code: 'WRONG_BASE_PATH' }); }
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
        const key = body.orderId as string; // the real pharmacy is idempotent on orderId (= Kiorex order id = Idempotency-Key)
        if (this.orders.has(key)) return send(200, { ...this.orders.get(key), replayed: true });
        if (this.orderMode === 'timeout') return hang();
        if (this.orderMode === '5xx') return send(503, {});
        if (this.orderMode === 'reject') return send(409, { statusCode: 409, code: 'BRANCH_NOT_OPTED_IN', message: 'Branch is not accepting Kiorex orders' });
        const o = { orderId: key, status: 'RECEIVED', slaDueAt: new Date(Date.now() + 600_000).toISOString() };
        this.orders.set(key, o);
        return send(201, { ...o, replayed: false });
      }
      if (m === 'POST' && path === '/prescriptions/validate') return send(200, { status: this.rxMode, reason: this.rxMode === 'INVALID' ? 'PRESCRIBER_NOT_VERIFIED' : undefined });
      if (m === 'POST' && /^\/orders\/[^/]+\/cancel$/.test(path)) return this.cancelMode === '409' ? send(409, { code: 'ALREADY_DISPENSED' }) : send(201, { status: 'CANCELLED' });
    } else {
      if (m === 'GET' && path === '/tests') { const q = (url.searchParams.get('q') ?? '').toLowerCase(); return send(200, { items: this.labTests.filter((t) => !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase() === q) }); }
      if (m === 'POST' && path === '/tests/quote') return send(200, { tests: body.testCodes.map((c: string) => this.labTests.find((t) => t.code === c)).filter(Boolean).map((t: any) => ({ code: t.code, name: t.name, priceMinor: t.priceMinor })), collectionFeeMinor: body.collectionType === 'HOME' ? 5000 : 0 });
      if (m === 'GET' && /^\/labs\/[^/]+\/slots$/.test(path)) { const f = new Date(url.searchParams.get('from')!).getTime(), t = new Date(url.searchParams.get('to')!).getTime(); return send(200, { slots: this.slots.filter((s) => new Date(s.startsAt).getTime() >= f && new Date(s.startsAt).getTime() <= t) }); }
      if (m === 'POST' && path === '/orders') {
        const key = body.sourceRef as string; // the real lab is idempotent on (client, sourceRef) and answers 200 with created:false on replay
        if (this.orders.has(key)) return send(200, { ...this.orders.get(key), created: false });
        if (this.orderMode === '5xx') return send(503, {});
        if (this.orderMode === 'reject') return send(409, { statusCode: 409, code: 'SLOT_FULL' });
        const o = { orderId: `lbo_${this.orders.size + 1}`, orderNumber: `TL-${this.orders.size + 1}`, status: 'AWAITING_COLLECTION' };
        this.orders.set(key, o);
        return send(200, { ...o, created: true });
      }
      if (m === 'POST' && /^\/orders\/[^/]+\/cancel$/.test(path)) return this.cancelMode === '409' ? send(409, { code: 'ALREADY_COLLECTED' }) : send(200, { orderId: 'x', status: 'CANCELLED' });
    }
    return send(404, { message: `no route ${m} ${path}` });
  }
}
