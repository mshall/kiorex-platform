// Hermetic stack for the widget Playwright suite (GRW-P1-G). Runs from apps/api (see playwright.config.ts):
//   :4393  the REAL Kiorex API (AppModule: embed host, SDK, session, config, booking, Postgres limiter) on its OWN throw-away database, fake Kiorly in-process
//   :4394  a stand-in for Kiorex Passport (discovery, /auth with a phone + one-time-code form, PKCE /token) minting API-valid tokens
//   :4392  "provider sites": host.html (SDK), iframe.html (plain iframe), attacker.html; reachable as http://localhost:4392 (allow-listed) and http://127.0.0.1:4392 (NOT allow-listed)
// Never uses 3000/5173/5175/3020/5190/5191 or any port of the shared dev stack.
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Client } from 'pg';

const API = 4393, IDP = 4394, SITES = 4392;
const DB = `kiorex_widget_e2e_${process.pid}`;
const ADMIN = 'postgresql://postgres:postgres@127.0.0.1:5433/postgres';
const DBURL = `postgresql://postgres:postgres@127.0.0.1:5433/${DB}?schema=public`;
Object.assign(process.env, {
  NODE_ENV: 'development', SITE_ENVIRONMENT: 'development', JOBS_ENABLED: 'false', PSP_MODE: 'sandbox-fake', KIORLY_TIMEOUT_MS: '2000', DATABASE_URL: DBURL, PORT: String(API),
  OIDC_ISSUER: `http://localhost:${IDP}`, OIDC_AUDIENCE: 'kiorex-api', WEB_BASE_URL: 'http://localhost:5180', STORAGE_LOCAL_DIR: '.data/e2e-widget-vault',
  WIDGET_DEV_ORIGINS: `http://localhost:${SITES}`, WIDGET_RATE_SLOTS_PER_MIN: '500', WIDGET_RATE_BOOKING_PER_MIN: '100', WIDGET_RATE_CONFIRM_PER_MIN: '200', WIDGET_RATE_CONFIG_PER_MIN: '500', WIDGET_RATE_SESSION_PER_MIN: '500',
});
delete process.env.WIDGET_HOST;

async function main() {
  const admin = new Client({ connectionString: ADMIN }); await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${DB}"`); await admin.query(`CREATE DATABASE "${DB}"`);
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: { ...process.env, DATABASE_URL: DBURL } });
  execSync('npm run build', { cwd: `${__dirname}/..`, stdio: 'ignore' });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCtx, futureSlot, seedProvider } = require('../../api/test/harness') as typeof import('../../api/test/harness');
  const ctx = await createCtx();
  await ctx.reset();
  const slots = Array.from({ length: 8 }, (_, i) => futureSlot(26 + i * 2));
  ctx.kiorly.slots = slots;
  ctx.kiorly.exclusiveHolds = true;
  await seedProvider(ctx, { specialty: 'dermatology', nameEn: 'Dr Sara Hassan', nameAr: 'د. سارة حسن' });
  await ctx.prisma.widgetRegistration.upsert({ where: { orgRef: 'cl_1' }, create: { orgRef: 'cl_1', orgSlug: 'nile-clinic', origins: ['https://clinic.example'] }, update: {} });
  await ctx.app.listen(API);

  // ---- Passport stand-in ------------------------------------------------------------------------------------------------------------------------
  const codes = new Map<string, { challenge: string; redirect: string; phone: string }>();
  const cors = (req: IncomingMessage, res: ServerResponse) => { const o = req.headers.origin; if (o) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); } res.setHeader('Access-Control-Allow-Headers', 'content-type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST'); };
  const body = (req: IncomingMessage) => new Promise<string>((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
  createServer(async (req, res) => {
    cors(req, res);
    const u = new URL(req.url ?? '/', `http://localhost:${IDP}`);
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (u.pathname === '/.well-known/openid-configuration') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ issuer: `http://localhost:${IDP}`, authorization_endpoint: `http://localhost:${IDP}/auth`, token_endpoint: `http://localhost:${IDP}/token` })); return; }
    if (u.pathname === '/auth' && req.method === 'GET') {
      const q = u.searchParams;
      if (q.get('client_id') !== 'kiorex-widget' || q.get('redirect_uri') !== `http://localhost:${API}/v1/embed/auth/callback` || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state')) { res.writeHead(400).end('bad authorize request'); return; }
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><html><head><meta charset=utf-8><title>Passport (test double)</title></head><body><h1>Kiorex Passport</h1><form method=post action="/auth/confirm"><input type=hidden name=state value="${esc(q.get('state')!)}"><input type=hidden name=challenge value="${esc(q.get('code_challenge')!)}"><input type=hidden name=redirect value="${esc(q.get('redirect_uri')!)}"><label>Phone <input name=phone value="+201000000077"></label> <label>One-time code <input name=otp value="123456"></label> <button id=verify type=submit>Verify and continue</button></form></body></html>`);
      return;
    }
    if (u.pathname === '/auth/confirm' && req.method === 'POST') {
      const f = new URLSearchParams(await body(req)); const code = randomBytes(12).toString('base64url');
      codes.set(code, { challenge: f.get('challenge')!, redirect: f.get('redirect')!, phone: f.get('phone') ?? '+201000000077' });
      res.writeHead(302, { Location: `${f.get('redirect')}?code=${code}&state=${encodeURIComponent(f.get('state')!)}` }).end(); return;
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      const f = new URLSearchParams(await body(req)); const c = codes.get(f.get('code') ?? '');
      const ok = c && f.get('redirect_uri') === c.redirect && createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') === c.challenge;
      if (!ok) { res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant' })); return; }
      codes.delete(f.get('code')!);
      const sub = `sub_widget_${c!.phone.replace(/\D/g, '')}`;
      const access = await ctx.token({ sub, phone: c!.phone, name: 'Mona Adel', iss: `http://localhost:${IDP}` });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: access, token_type: 'Bearer', expires_in: 900 })); return;
    }
    res.writeHead(404).end();
  }).listen(IDP);

  // ---- provider sites ---------------------------------------------------------------------------------------------------------------------------
  const widget = `http://localhost:${API}`;
  const page = (inner: string, head = '') => `<!doctype html><html><head><meta charset=utf-8><title>Provider site</title>${head}</head><body><h1>Nile Clinic website</h1>${inner}</body></html>`;
  createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', `http://localhost:${SITES}`); const q = u.searchParams;
    const send = (code: number, type: string, b: string) => res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }).end(b);
    if (u.pathname === '/__state') {
      const intents = await ctx.prisma.bookingIntent.findMany({ orderBy: { createdAt: 'asc' } });
      send(200, 'application/json', JSON.stringify({ intents: intents.map((i) => ({ id: i.id, status: i.status, channel: i.channel, failureCode: i.failureCode, startsAt: i.startsAt })), kiorlyBookings: ctx.kiorly.callsTo('POST', '/bookings').map((c) => ({ channel: c.body.channel, bookingPageSlug: c.body.bookingPageSlug, key: c.headers['idempotency-key'] })), audit: (await ctx.prisma.auditLog.findMany({ where: { action: 'widget.origin_denied' } })).length })); return;
    }
    if (u.pathname === '/__reset') {
      await ctx.prisma.bookingIntent.deleteMany({}); ctx.kiorly.bookings.clear(); ctx.kiorly.holds.clear(); ctx.kiorly.calls = [];
      await ctx.prisma.$executeRawUnsafe('DELETE FROM "RateLimitBucket"'); await ctx.prisma.auditLog.deleteMany({ where: { action: 'widget.origin_denied' } });
      send(204, 'text/plain', ''); return;
    }
    if (u.pathname === '/__hold-others') { // another visitor takes the slot the test is about to choose
      const t = q.get('startsAt')!; ctx.kiorly.holds.set(`other:${t}`, { clinicianId: 'dr_1', startsAt: t, externalRef: `other:${t}` }); send(204, 'text/plain', ''); return;
    }
    const attrs = ['org', 'doctor', 'specialty', 'locale', 'color', 'radius', 'logo', 'lt'].filter((k) => q.get(k)).map((k) => ` data-${k}="${q.get(k)!.replace(/"/g, '')}"`).join('');
    if (u.pathname === '/host.html') {
      send(200, 'text/html', page(`<p>Book online:</p><div id=mount data-kx-widget data-org="${q.get('org') ?? 'nile-clinic'}"${attrs.replace(/ data-org="[^"]*"/, '')}></div><pre id=events></pre><script>document.addEventListener('kx:booked',function(e){document.getElementById('events').textContent+=JSON.stringify(e.detail)+'\\n'});document.addEventListener('kx:error',function(e){document.getElementById('events').textContent+='error:'+e.detail.code+'\\n'});</script><script src="${widget}/v1/sdk.js" async></script>`)); return;
    }
    if (u.pathname === '/iframe.html') {
      send(200, 'text/html', page(`<iframe id=plain title="Book" width=100% height=640 style="border:0" src="${widget}/v1/embed/${q.get('org') ?? 'nile-clinic'}?locale=${q.get('locale') ?? 'en'}" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"></iframe>`)); return;
    }
    if (u.pathname === '/attacker.html') {
      send(200, 'text/html', page(`<script>var f=window.parent;f.postMessage({kx:1,type:'kx:resize',height:50},'*');f.postMessage({kx:1,type:'kx:booked',status:'CONFIRMED',bookingRef:'forged_ref'},'*');f.postMessage({kx:1,type:'kx:error',code:'FORGED'},'*');</script>`)); return;
    }
    if (u.pathname === '/spoof.html') { // an embedding page that is NOT allow-listed when opened on 127.0.0.1
      send(200, 'text/html', page(`<iframe id=spoof title="x" width=100% height=500 src="${widget}/v1/embed/nile-clinic?locale=en"></iframe>`)); return;
    }
    res.writeHead(404).end();
  }).listen(SITES, '0.0.0.0');

  const stop = async () => { try { await ctx.close(); } catch { /* ignore */ } try { await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`); await admin.end(); } catch { /* ignore */ } process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  process.stdout.write(`[widget-e2e] ready api=:${API} idp=:${IDP} sites=:${SITES} db=${DB}\n`);
}
main().catch((e) => { process.stderr.write(`${e?.stack ?? e}\n`); process.exit(1); });
