import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { createCtx, futureSlot, seedProvider, TestCtx } from './harness';
import { OutboxService } from '../src/outbox/outbox-public';

/**
 * Response-schema contract: real responses are validated against the COMMITTED openapi/kiorex-api.v1.openapi.json (regenerate with
 * `npm run openapi:export -w apps/api`). Web/mobile generate their types from this file, so drift here breaks them.
 */
const doc = JSON.parse(readFileSync(join(__dirname, '..', 'openapi', 'kiorex-api.v1.openapi.json'), 'utf8'));
const schemas: Record<string, any> = doc.components.schemas;

function check(schema: any, v: unknown, path: string, errs: string[]) {
  if (!schema) return;
  if (v === null) { if (!schema.nullable) errs.push(`${path}: null not allowed`); return; }
  if (schema.$ref) return check(schemas[schema.$ref.split('/').pop()!], v, path, errs);
  if (schema.allOf) { for (const s of schema.allOf) check(s, v, path, errs); return; }
  if (v === undefined) return;
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${path}: ${JSON.stringify(v)} not in enum ${schema.enum.join('|')}`);
  const t = schema.type;
  if (t === 'string' && typeof v !== 'string') errs.push(`${path}: expected string, got ${typeof v}`);
  if (t === 'number' && typeof v !== 'number') errs.push(`${path}: expected number, got ${typeof v}`);
  if (t === 'integer' && !Number.isInteger(v)) errs.push(`${path}: expected integer`);
  if (t === 'boolean' && typeof v !== 'boolean') errs.push(`${path}: expected boolean, got ${typeof v}`);
  if (t === 'array') { if (!Array.isArray(v)) return void errs.push(`${path}: expected array`); v.forEach((x, i) => check(schema.items, x, `${path}[${i}]`, errs)); return; }
  if (t === 'object' || schema.properties) {
    if (typeof v !== 'object' || Array.isArray(v)) return void errs.push(`${path}: expected object`);
    const o = v as Record<string, unknown>;
    for (const r of schema.required ?? []) if (!(r in o)) errs.push(`${path}.${r}: required but missing`);
    for (const [k, s] of Object.entries<any>(schema.properties ?? {})) if (k in o) check(s, o[k], `${path}.${k}`, errs);
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') for (const [k, x] of Object.entries(o)) if (!(schema.properties ?? {})[k]) check(schema.additionalProperties, x, `${path}.${k}`, errs);
  }
}
const responseSchema = (method: string, path: string, status: number) => doc.paths[`/api/v1${path}`]?.[method.toLowerCase()]?.responses?.[String(status)]?.content?.['application/json']?.schema;

describe('OpenAPI response schemas (committed spec) match real responses', () => {
  it('only genuinely mandatory query params are required', () => {
    const req: string[] = [];
    for (const [path, item] of Object.entries<any>(doc.paths)) for (const [m, op] of Object.entries<any>(item)) for (const q of op.parameters ?? []) if (q.in === 'query' && q.required) req.push(`${m} ${path} ${q.name}`);
    expect(req.sort()).toEqual([
      'get /api/v1/control/v1/flags/snapshot product', 'get /api/v1/dev/channels/whatsapp/conversation phone', 'get /api/v1/lab/slots labId',
      'get /api/v1/providers/{id}/slots typeId', 'get /api/v1/rx/verify t',
    ]);
  });

  it('every operation documents a 2xx response body', () => {
    const missing: string[] = [];
    for (const [p, ops] of Object.entries<any>(doc.paths)) for (const [m, o] of Object.entries<any>(ops)) if (!Object.entries<any>(o.responses ?? {}).some(([c, r]) => c.startsWith('2') && r.content)) missing.push(`${m.toUpperCase()} ${p}`);
    expect(missing).toEqual([]);
    expect(Object.keys(doc.paths).length).toBeGreaterThan(120);
  });

  describe('live responses', () => {
    let c: TestCtx; let auth: { Authorization: string }; let admin: { Authorization: string }; let pid: string;
    beforeAll(async () => { c = await createCtx(); });
    afterAll(async () => { await c.close(); });
    beforeEach(async () => {
      await c.reset();
      c.kiorly.slots = [futureSlot(72), futureSlot(73)]; pid = await seedProvider(c, { depositAmount: 100 });
      auth = await c.as('sub_amira'); admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
      process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
    });
    const verify = async (method: 'get' | 'post' | 'put' | 'delete', openApiPath: string, req: { path?: string; headers?: any; body?: any }, status = 200) => {
      const r = await (c.http() as any)[method](`/api/v1${req.path ?? openApiPath}`).set(req.headers ?? {}).send(req.body);
      expect(r.status).toBe(status);
      const schema = responseSchema(method, openApiPath, status);
      expect(schema).toBeTruthy();
      const errs: string[] = [];
      check(schema, r.body, openApiPath, errs);
      expect({ route: `${method.toUpperCase()} ${openApiPath}`, errs }).toEqual({ route: `${method.toUpperCase()} ${openApiPath}`, errs: [] });
      return r.body;
    };

    it('patient, catalog, booking, engagement, pay, trust, vault, waitlist', async () => {
      await verify('get', '/markets', {});
      await verify('get', '/specialties', {});
      const body = await verify('get', '/search/providers', {});
      expect(body.items.length).toBe(1);
      await verify('get', '/search/providers', { path: '/search/providers?q=chest%20pain' });
      await verify('get', '/providers/{id}', { path: `/providers/${pid}` });
      await verify('get', '/providers/{id}/slots', { path: `/providers/${pid}/slots?typeId=typ_1` });
      await verify('get', '/providers/{id}/reviews', { path: `/providers/${pid}/reviews` });
      await verify('get', '/flags/effective', {});
      await verify('get', '/health/live', {});
      await verify('get', '/health/ready', {});
      await verify('get', '/auth/me', { headers: auth });
      await verify('get', '/me/profile', { headers: auth });
      await verify('put', '/me/profile', { headers: auth, body: { nameEn: 'Amira Samy', email: 'amira@example.test' } });
      await verify('post', '/me/dependants', { headers: auth, body: { nameEn: 'Kid', dateOfBirth: new Date(Date.now() - 3 * 365 * 86400_000).toISOString().slice(0, 10), relationship: 'CHILD' } }, 201);
      await verify('get', '/me/dependants', { headers: auth });
      await verify('put', '/me/consents/{purpose}', { path: '/me/consents/MARKETPLACE_PROCESSING', headers: auth, body: { granted: true } });
      await verify('get', '/me/consents', { headers: auth });
      await verify('get', '/me/consents/history', { headers: auth });
      await verify('get', '/me/sessions', { headers: await c.as('sub_amira', { sid: 'sid_1' }) });
      await verify('get', '/me/kiorly-links', { headers: auth });
      const h = await verify('post', '/bookings', { headers: auth, body: { providerId: pid, typeId: 'typ_1', ...futureSlot(72) } }, 201);
      await verify('get', '/bookings/{id}', { path: `/bookings/${h.id}`, headers: auth });
      const done = await verify('post', '/bookings/{id}/confirm', { path: `/bookings/${h.id}/confirm`, headers: auth, body: { marketplaceConsent: true } });
      expect(done.status).toBe('CONFIRMED');
      await verify('get', '/bookings', { headers: auth });
      const dep = await verify('post', '/bookings/{id}/deposit-checkout', { path: `/bookings/${h.id}/deposit-checkout`, headers: auth });
      await verify('get', '/pay/intents/{id}', { path: `/pay/intents/${dep.paymentId}`, headers: auth });
      await verify('post', '/pay/fake-checkout/{id}/complete', { path: `/pay/fake-checkout/${dep.paymentId}/complete`, body: { outcome: 'pay' } });
      await c.get(OutboxService).processBatch();
      await verify('post', '/bookings/{id}/reschedule', { path: `/bookings/${h.id}/reschedule`, headers: auth, body: { startsAt: futureSlot(73).startsAt } });
      await verify('get', '/me/notifications', { headers: auth });
      await verify('get', '/me/notification-preferences', { headers: auth });
      await verify('put', '/me/notification-preferences/{channel}', { path: '/me/notification-preferences/PUSH', headers: auth, body: { enabled: true } });
      await verify('post', '/complaints', { headers: auth, body: { category: 'SERVICE', body: 'slow' } }, 201);
      await verify('post', '/navigation/symptoms', { headers: auth, body: { text: 'skin rash' } });
      await verify('post', '/navigation/symptoms', { headers: auth, body: { text: 'chest pain' } });
      await verify('get', '/me/vault', { headers: auth });
      await verify('get', '/me/record-sharing', { headers: auth });
      await verify('put', '/me/record-sharing/{scope}', { path: '/me/record-sharing/VISIT_SUMMARY', headers: auth, body: { granted: true } });
      const up = await verify('post', '/me/vault/uploads', { headers: auth, body: { fileName: 'a.png', mimeType: 'image/png', contentBase64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(30, 2)]).toString('base64') } }, 201);
      await verify('get', '/me/vault/{id}', { path: `/me/vault/${up.id}`, headers: auth });
      await verify('post', '/me/follow-ups', { headers: auth, body: { afterDays: 5, recordId: up.id } }, 201);
      await verify('get', '/me/follow-ups', { headers: auth });
      await verify('get', '/me/prescriptions', { headers: auth });
      await verify('get', '/rx/verify', { path: '/rx/verify?t=bad' });
      c.kiorly.slots = [];
      await verify('post', '/waitlist', { headers: auth, body: { providerId: pid, typeId: 'typ_1' } }, 201);
      await verify('get', '/waitlist', { headers: auth });
      await verify('post', '/analytics/events', { body: { events: [{ name: 'search_started', props: { specialtyCode: 'dermatology' } }] } }, 202);
      await verify('post', '/me/export', { headers: auth });
      await verify('delete', '/me/dependants/{id}', { path: `/me/dependants/${(await c.prisma.dependant.findFirstOrThrow({})).id}`, headers: auth });
      await verify('post', '/me/deletion', { headers: auth, body: { confirm: true } });
    });

    it('ops, control plane, messaging, dev inbox', async () => {
      await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
      await c.http().put('/api/v1/me/consents/MARKETPLACE_PROCESSING').set(auth).send({ granted: true });
      const h = await c.http().post('/api/v1/bookings').set(auth).send({ providerId: pid, typeId: 'typ_1', ...futureSlot(72) }).expect(201);
      await c.http().post(`/api/v1/bookings/${h.body.id}/confirm`).set(auth).send({ marketplaceConsent: true }).expect(200);
      await verify('get', '/admin/providers', { headers: admin });
      await verify('get', '/admin/bookings', { headers: admin });
      await verify('get', '/admin/bookings/{id}/timeline', { path: `/admin/bookings/${h.body.id}/timeline`, headers: admin });
      await verify('get', '/admin/outbox', { headers: admin });
      await verify('get', '/admin/payments/dashboard', { headers: admin });
      await verify('get', '/admin/fee-statements', { headers: admin });
      await verify('post', '/admin/payouts/run', { headers: admin });
      await verify('post', '/admin/reconciliation/psp/run', { headers: admin });
      await verify('get', '/admin/reconciliation/runs', { headers: admin });
      await verify('get', '/admin/liquidity', { headers: admin });
      await verify('get', '/admin/circuits', { headers: admin });
      await verify('get', '/admin/moderation', { headers: admin });
      await verify('get', '/admin/complaints', { headers: admin });
      await verify('get', '/admin/messages', { headers: admin });
      await verify('get', '/admin/audit-log', { headers: admin });
      await verify('get', '/admin/messaging/stats', { headers: admin });
      await verify('get', '/admin/messaging/log', { headers: admin });
      await verify('post', '/admin/messaging/delivery-tick', { headers: admin });
      await verify('get', '/care-types', {});
      await verify('get', '/home/districts', {});
      await verify('get', '/me/addresses', { headers: auth });
      const ad = await verify('post', '/me/addresses', { headers: auth, body: { label: 'Home', governorate: 'Cairo', district: 'maadi', street: 'Street 1' } }, 201);
      await verify('post', '/me/addresses/{id}/confirm', { path: `/me/addresses/${ad.id}/confirm`, headers: auth });
      await verify('get', '/admin/safety/alerts', { headers: admin });
      await verify('get', '/admin/safety/summary', { headers: admin });
      await verify('get', '/admin/safety/escalations', { headers: admin });
      await verify('get', '/admin/safety/unsafe-aborts', { headers: admin });
      await verify('get', '/admin/payments/held-for-review', { headers: admin });
      await verify('get', '/admin/home-visits/gate-metric', { headers: admin });
      await verify('get', '/admin/gates', { headers: admin });
      await verify('get', '/care-plans', { headers: auth });
      await verify('get', '/admin/flags', { headers: admin });
      await verify('get', '/admin/flags/requests', { headers: admin });
      await verify('get', '/admin/flags/audit', { headers: admin });
      await verify('get', '/admin/flags/propagation', { headers: admin });
      await verify('put', '/admin/flags/{key}/values', { path: '/admin/flags/kiorex.reviews/values', headers: admin, body: { scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1' } });
      await verify('put', '/admin/flags/{key}/gate', { path: '/admin/flags/kiorex.telemedicine/gate', headers: admin, body: { gateId: 'TEST-FIXTURE', approver: 'fixture', approvedOn: '2027-01-01', documentUrl: 'https://example.test/x' } });
      await verify('post', '/admin/flags/sweep', { headers: admin });
      const inb = await verify('post', '/dev/messaging/inbound', { body: { channel: 'WHATSAPP', from: '+201000000001', text: 'hi' } });
      expect(Array.isArray(inb.replies)).toBe(true);
      await verify('get', '/dev/messaging/outbox', {});
      await verify('post', '/dev/messaging/delivery-tick', {});
    });
  });
});

describe('OpenAPI DTO naming', () => {
  /** @nestjs/swagger keys schemas by class name, so two different classes with one name silently merge (wrong fields for one of them). */
  it('no two DTO/body classes in apps/api/src share a class name', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) files.push(p); } };
    walk(join(__dirname, '..', 'src'));
    const seen = new Map<string, string[]>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/gm)) seen.set(m[1], [...(seen.get(m[1]) ?? []), f.slice(f.indexOf('src/'))]);
    const dups = [...seen.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k}: ${v.join(', ')}`);
    expect(dups).toEqual([]);
  });
});
