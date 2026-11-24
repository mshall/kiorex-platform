import { INTAKE_NONCE_PATTERN } from '@kiorex/contracts';
import { badRequest } from '../common/errors';
import { CONN_KINDS, needsHandshakeCreds, type ConnKind } from './steps';

/** Strict shape of the public intake body (contracts 1.9.0 `ConnectionRequest`): unknown fields are refused, every field has a type and a length cap. */
export interface IntakeBody {
  nonce: string; kind: ConnKind; orgRef: string; name: string; nameAr?: string; market?: string; contactEmail?: string; locale?: string; statusToken?: string;
  baseUrl?: string; clientKey?: string; clientSecret?: string; webhookSecret?: string; readiness?: Record<string, any>;
}
const ALLOWED = new Set(['nonce', 'kind', 'orgRef', 'name', 'nameAr', 'market', 'contactEmail', 'locale', 'statusToken', 'baseUrl', 'clientKey', 'clientSecret', 'webhookSecret', 'readiness']);
const HOST_RE = /^https?:\/\/[^/\s?#]+$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,120}\.[^\s@]{2,}$/;
const ORGREF_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const CTRL_RE = /[\u0000-\u001f\u007f]/;
export const READINESS_MAX_BYTES = 8000;

const str = (v: unknown, field: string, max: number, min = 1) => {
  if (typeof v !== 'string' || v.length < min || v.length > max || CTRL_RE.test(v)) throw badRequest('INVALID_REQUEST', `Invalid ${field}`, { field });
  return v;
};

export function parseIntakeBody(raw: string): IntakeBody {
  let b: any; try { b = JSON.parse(raw); } catch { throw badRequest('INVALID_JSON', 'Body is not JSON'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw badRequest('INVALID_REQUEST', 'Body must be a JSON object');
  for (const k of Object.keys(b)) if (!ALLOWED.has(k)) throw badRequest('INVALID_REQUEST', 'Unknown field', { field: k.slice(0, 40) });
  if (!CONN_KINDS.includes(b.kind)) throw badRequest('INVALID_KIND', 'kind must be CLINIC, NURSE, PHARMACY or LAB');
  const out: IntakeBody = { kind: b.kind, nonce: str(b.nonce, 'nonce', 64, 16), orgRef: str(b.orgRef, 'orgRef', 80), name: str(b.name, 'name', 160) };
  if (!INTAKE_NONCE_PATTERN.test(out.nonce)) throw badRequest('INVALID_REQUEST', 'Invalid nonce', { field: 'nonce' });
  if (!ORGREF_RE.test(out.orgRef)) throw badRequest('INVALID_REQUEST', 'Invalid orgRef', { field: 'orgRef' });
  if (b.nameAr !== undefined) out.nameAr = str(b.nameAr, 'nameAr', 160);
  if (b.market !== undefined) { out.market = str(b.market, 'market', 2, 2).toUpperCase(); if (!/^[A-Z]{2}$/.test(out.market)) throw badRequest('INVALID_REQUEST', 'Invalid market', { field: 'market' }); }
  if (b.contactEmail !== undefined && b.contactEmail !== null) { out.contactEmail = str(b.contactEmail, 'contactEmail', 160); if (!EMAIL_RE.test(out.contactEmail)) throw badRequest('INVALID_REQUEST', 'Invalid contactEmail', { field: 'contactEmail' }); }
  if (b.locale !== undefined) { if (b.locale !== 'ar' && b.locale !== 'en') throw badRequest('INVALID_REQUEST', 'Invalid locale', { field: 'locale' }); out.locale = b.locale; }
  if (b.statusToken !== undefined) { out.statusToken = str(b.statusToken, 'statusToken', 128, 32); if (!/^[A-Za-z0-9_-]+$/.test(out.statusToken)) throw badRequest('INVALID_REQUEST', 'Invalid statusToken', { field: 'statusToken' }); }
  if (b.readiness !== undefined) {
    if (!b.readiness || typeof b.readiness !== 'object' || Array.isArray(b.readiness)) throw badRequest('INVALID_REQUEST', 'Invalid readiness', { field: 'readiness' });
    if (JSON.stringify(b.readiness).length > READINESS_MAX_BYTES) throw badRequest('READINESS_TOO_LARGE', 'readiness snapshot is too large');
    out.readiness = b.readiness;
  }
  if (needsHandshakeCreds(out.kind)) {
    const baseUrl = typeof b.baseUrl === 'string' ? b.baseUrl.replace(/\/+$/, '') : '';
    if (!HOST_RE.test(baseUrl) || baseUrl.length > 200) throw badRequest('INVALID_BASE_URL', 'baseUrl must be a host URL without a path');
    for (const [f, max] of [['clientKey', 120], ['clientSecret', 200], ['webhookSecret', 200]] as const) {
      if (typeof b[f] !== 'string' || !b[f] || b[f].length > max || CTRL_RE.test(b[f])) throw badRequest('CREDENTIALS_REQUIRED', 'clientKey, clientSecret and webhookSecret are required');
    }
    out.baseUrl = baseUrl; out.clientKey = b.clientKey; out.clientSecret = b.clientSecret; out.webhookSecret = b.webhookSecret;
  } else if (b.baseUrl !== undefined || b.clientKey !== undefined || b.clientSecret !== undefined || b.webhookSecret !== undefined) {
    throw badRequest('INVALID_REQUEST', 'Credentials are only accepted for PHARMACY and LAB');
  }
  return out;
}
