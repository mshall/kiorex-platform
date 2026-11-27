#!/usr/bin/env node
// Validates apps/api/env/<tag>.env.template and its containers file (ADR-059, ENVIRONMENT_CONFIGURATION_STANDARD).
//   node scripts/validate-env-template.mjs [--template apps/api/env/kx-test.env.template] [--containers apps/api/env/kx-test.containers.json] [--generated .generated/env/test/api.env] [--json]
// Rules: names only known to the API source; secrets by reference only (secretref:/<product>/<env>/<purpose>); hosts only as @registry (and present in the
// generated file when given); every provider mode is mock; production-safe flags; JOBS_ENABLED true on EXACTLY ONE container. Never prints a value.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export const SECRET_NAME = /(SECRET|API_KEY|CLIENT_KEY|ENCRYPTION_KEY|PEPPER|PASSWORD|TOKEN|SERVICE_ACCOUNT_JSON|ORG_KEY_MASTER|DB_SECRET_ARN)/;
export const HOST_NAMES = ['PUBLIC_BASE_URL', 'PUBLIC_APP_URL', 'WEB_BASE_URL', 'SITE_CANONICAL_HOST', 'CORS_ORIGINS', 'OIDC_ISSUER', 'KIORLY_BASE_URL', 'WIDGET_HOST', 'KX_ENV', 'KX_ENV_TAG'];
export const REQUIRED = [...HOST_NAMES, 'NODE_ENV', 'JOBS_ENABLED', 'DB_SECRET_ARN', 'FIELD_ENCRYPTION_KEY', 'KIORLY_CLIENT_SECRET', 'KIORLY_WEBHOOK_SECRET', 'PSP_FAKE_WEBHOOK_SECRET',
  'WHATSAPP_WEBHOOK_SECRET', 'KIOREX_RECORD_SHARE_HMAC_SECRET', 'RX_VERIFY_HMAC_SECRET', 'PARTNER_LEAD_SIGNING_SECRET', 'SMS_MODE', 'EMAIL_MODE', 'WHATSAPP_MODE', 'PAYMENT_MODE'];
const REF = /^secretref:\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/;
const MOCK_MODE = new Set(['mock', 'fake', 'local']);
/** Names set by the platform tooling and not read through process.env in src (registry identity, container entrypoint). */
const TOOLING_NAMES = new Set(['KX_ENV', 'KX_ENV_TAG', 'KX_PLANE', 'KX_REGISTRY_HASH', 'WIDGET_EMBED_HOST', 'WIDGET_PRODUCTION_HOST']);

export function parseEnv(text) {
  const out = new Map(); const dup = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim(); if (!l || l.startsWith('#')) return;
    const eq = l.indexOf('='); if (eq < 1) { out.set(`__bad_${i + 1}`, l); return; }
    const k = l.slice(0, eq).trim(); if (out.has(k)) dup.push(k); out.set(k, l.slice(eq + 1).trim());
  });
  return { vars: out, dup };
}

/** Names the API source reads (any upper-case token in apps/api/src, entrypoint, Dockerfile). */
export function knownNames(apiDir = path.join(root, 'apps', 'api')) {
  const set = new Set();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!['node_modules', 'generated', 'dist'].includes(e.name)) walk(p); } else if (/\.(ts|mjs|js)$/.test(e.name) && !/\.spec\./.test(e.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) set.add(m[0]); } };
  walk(path.join(apiDir, 'src')); for (const f of ['docker-entrypoint.mjs', 'Dockerfile']) { const p = path.join(apiDir, f); if (fs.existsSync(p)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g)) set.add(m[0]); }
  return set;
}

export function validate({ template, containers, generated, known }) {
  const errors = [];
  const { vars, dup } = parseEnv(template);
  for (const d of dup) errors.push(`duplicate name ${d}`);
  for (const [k, v] of vars) {
    if (k.startsWith('__bad_')) { errors.push(`line is not NAME=value (line ${k.slice(6)})`); continue; }
    if (!/^[A-Z][A-Z0-9_]+$/.test(k)) errors.push(`${k}: invalid variable name`);
    if (known && !known.has(k) && !TOOLING_NAMES.has(k)) errors.push(`${k}: not read anywhere by the API (typo or stale name)`);
    const isSecret = SECRET_NAME.test(k) && !/^(OIDC_AUDIENCE)$/.test(k);
    if (isSecret && !REF.test(v)) errors.push(`${k}: a secret must be a reference secretref:/<product>/<env>/<purpose> (value withheld)`);
    if (!isSecret && v.startsWith('secretref:')) errors.push(`${k}: unexpected secretref on a non-secret name`);
    if (isSecret && REF.test(v) && !v.includes('/test/')) errors.push(`${k}: reference must point at the test environment path`);
    if (HOST_NAMES.includes(k) && v !== '@registry') errors.push(`${k}: host and identity values must be @registry (generated), never typed`);
    if (!isSecret && v !== '@registry' && /https?:\/\/|\b[a-z0-9-]+\.(com|link|net|org|io)\b|localhost|\b\d{1,3}(\.\d{1,3}){3}\b/i.test(v)) errors.push(`${k}: contains a host literal (use @registry)`);
    if (/_MODE$/.test(k) && !MOCK_MODE.has(v) && k !== 'SITE_SEARCH_ENGINE_MODE') errors.push(`${k}: kx-test stays on mock providers (value is "${v}")`);
    if (k === 'AI_PROVIDER' && v !== 'fake') errors.push('AI_PROVIDER must be fake in kx-test');
  }
  for (const n of REQUIRED) if (!vars.has(n)) errors.push(`${n}: required name missing`);
  if (vars.get('NODE_ENV') !== 'production') errors.push('NODE_ENV must be production (production-shaped boot checks apply to kx-test)');
  if (vars.has('ALLOW_INSECURE_DEFAULT_SECRETS')) errors.push('ALLOW_INSECURE_DEFAULT_SECRETS must not be set');
  if (vars.get('SWAGGER_ENABLED') === 'true') errors.push('SWAGGER_ENABLED must not be true');
  if (vars.get('SITE_ENVIRONMENT') && vars.get('SITE_ENVIRONMENT') === 'production') errors.push('SITE_ENVIRONMENT=production would make the test site indexable');
  if (vars.get('JOBS_ENABLED') !== 'false') errors.push('template JOBS_ENABLED must default to false (per-container override turns it on)');
  if (generated) { const g = parseEnv(generated).vars; for (const [k, v] of vars) if (v === '@registry' && !g.has(k)) errors.push(`${k}: marked @registry but the generated file does not define it`); }
  // containers
  const list = containers?.containers ?? [];
  if (!list.length) errors.push('containers file lists no container');
  const names = list.map((c) => c.name); if (new Set(names).size !== names.length) errors.push('container names must be unique');
  const on = list.filter((c) => (c.env?.JOBS_ENABLED ?? vars.get('JOBS_ENABLED')) === 'true');
  if (on.length !== 1) errors.push(`JOBS_ENABLED must be true on exactly one container (found ${on.length})`);
  for (const c of list) for (const k of Object.keys(c.env ?? {})) if (k !== 'JOBS_ENABLED') errors.push(`container ${c.name}: only JOBS_ENABLED may differ per container (found ${k})`);
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const tpl = path.resolve(val('--template') ?? path.join(root, 'apps/api/env/kx-test.env.template'));
  const cont = path.resolve(val('--containers') ?? path.join(root, 'apps/api/env/kx-test.containers.json'));
  const gen = val('--generated');
  const errors = validate({ template: fs.readFileSync(tpl, 'utf8'), containers: JSON.parse(fs.readFileSync(cont, 'utf8')), generated: gen ? fs.readFileSync(path.resolve(gen), 'utf8') : undefined, known: knownNames() });
  if (a.includes('--json')) console.log(JSON.stringify({ ok: !errors.length, errors }));
  else if (errors.length) { console.error(`env template INVALID (${errors.length}):`); for (const e of errors) console.error('  - ' + e); } else console.log(`env template OK: ${path.relative(root, tpl)}`);
  process.exit(errors.length ? 1 : 0);
}
