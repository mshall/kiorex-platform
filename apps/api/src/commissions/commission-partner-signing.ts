import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * LG-COM-19 hardening of the partner settlement-statement route (read only).
 *
 * 1. Per-organisation Clinic credentials. Pharmacy and Lab already sign with a secret registered per partner. The Clinic used ONE shared secret for every tenant, so a leak of it
 *    exposed every tenant's statement. A Clinic tenant's signing secret can now be DERIVED: HMAC-SHA256(master, "kiorex-statement-org-v1|" + orgRef), hex. The master never leaves
 *    Kiorex; the Clinic (or the operator provisioning it) gets only the per-organisation value. An explicit per-organisation map can pin a value instead (for rotation of one tenant).
 *    Both are configuration (secrets by reference in the environment, never committed). The shared secret keeps working while COMMISSION_STATEMENT_CLINIC_AUTH is `either` (default).
 * 2. Signed query string. The contract HMAC covers method, path (query stripped) and body hash, so `from`/`to`/`orgRef` could be altered in transit. A second HMAC,
 *    `X-Kiorly-Query-Signature`, covers the canonical string below: same secret, same timestamp and nonce as the request signature, so it cannot be replayed on another request.
 */

export type ClinicAuthMode = 'shared' | 'either' | 'per_org';
export type QuerySignatureMode = 'optional' | 'required';

export const QUERY_SIGNATURE_HEADER = 'x-kiorly-query-signature';

export const clinicAuthMode = (): ClinicAuthMode => { const v = (process.env.COMMISSION_STATEMENT_CLINIC_AUTH ?? '').toLowerCase(); return v === 'shared' || v === 'per_org' ? v : 'either'; };
export const querySignatureMode = (): QuerySignatureMode => ((process.env.COMMISSION_STATEMENT_QUERY_SIGNATURE ?? '').toLowerCase() === 'required' ? 'required' : 'optional');

/** Explicit per-organisation secrets: COMMISSION_STATEMENT_ORG_SECRETS = JSON object {"<orgRef>": "<secret>"}. Invalid JSON is ignored (fail closed to the derived key). */
function secretMap(): Record<string, string> {
  const raw = process.env.COMMISSION_STATEMENT_ORG_SECRETS;
  if (!raw) return {};
  try { const o = JSON.parse(raw) as unknown; if (!o || typeof o !== 'object' || Array.isArray(o)) return {}; return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v.length >= 16)) as Record<string, string>; } catch { return {}; }
}

/** The signing secret of one Clinic organisation, or null when no per-organisation credential is configured (master unset and no map entry). */
export function clinicOrgSecret(orgRef: string): string | null {
  const m = secretMap()[orgRef];
  if (m) return m;
  const master = process.env.COMMISSION_STATEMENT_ORG_KEY_MASTER;
  if (!master || master.length < 16) return null;
  return createHmac('sha256', master).update(`kiorex-statement-org-v1|${orgRef}`).digest('hex');
}

/** Sorted `key=value` pairs, percent-encoded, repeated keys sorted by value; empty query = empty string. Stable whatever the order the client sent. */
export function canonicalQuery(query: Record<string, unknown> | string | undefined): string {
  const pairs: [string, string][] = [];
  if (typeof query === 'string') { for (const [k, v] of new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)) pairs.push([k, v]); }
  else if (query) for (const [k, v] of Object.entries(query)) { if (v === undefined) continue; for (const x of Array.isArray(v) ? v : [v]) pairs.push([k, String(x)]); }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export const queryCanonicalString = (i: { timestamp: string; nonce: string; method: string; path: string; query: Record<string, unknown> | string | undefined }) =>
  `kiorly-query-v1\n${i.timestamp}\n${i.nonce}\n${i.method.toUpperCase()}\n${i.path}\n${canonicalQuery(i.query)}`;

export const signStatementQuery = (secret: string, i: Parameters<typeof queryCanonicalString>[0]): string => createHmac('sha256', secret).update(queryCanonicalString(i)).digest('base64url');

export function verifyStatementQuery(secret: string, signature: string, i: Parameters<typeof queryCanonicalString>[0]): boolean {
  const a = Buffer.from(signStatementQuery(secret, i)); const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
