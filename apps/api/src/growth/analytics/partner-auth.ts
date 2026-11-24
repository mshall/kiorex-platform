import { verifyKiorlyRequest } from '@kiorex/contracts';
import { createHash } from 'node:crypto';
import { cfg } from '../../common/config';
import { ApiError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';

type Req = { originalUrl: string; method: string; rawBody?: Buffer; headers: Record<string, string | string[] | undefined> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Signed Kiorly Clinic request (same scheme as the evidence endpoint): client key, timestamp, one-time nonce and HMAC over method, path and body hash. The organisation
 * is `X-Kiorly-Org-Ref`. KNOWN LIMIT (same as evidence): the Clinic signs with one shared secret, so the org reference is a claim by an authenticated Clinic, not a per-organisation proof.
 */
export async function authenticatePartnerOrg(req: Req, prisma: PrismaService, scope: string): Promise<string> {
  if (!req.headers['x-kiorly-signature']) throw new ApiError(401, 'UNAUTHENTICATED', 'A signed partner request is required');
  const c = cfg();
  const v = one(req.headers['x-kiorly-client-key']) === c.kiorlyClientKey ? verifyKiorlyRequest({ headers: req.headers, method: req.method, path: req.originalUrl.split('?')[0]!, body: req.rawBody ?? Buffer.alloc(0), secret: c.kiorlyWebhookSecret }) : { ok: false };
  if (!(v as { ok: boolean }).ok) throw new ApiError(401, 'PARTNER_UNAUTHORIZED', 'Request could not be authenticated');
  const nonce = createHash('sha256').update(`${scope}|${one(req.headers['x-kiorly-nonce'])}`).digest('hex');
  try { await prisma.partnerIntakeNonce.create({ data: { id: nonce } }); } catch { throw new ApiError(401, 'PARTNER_UNAUTHORIZED', 'Request could not be authenticated'); }
  const org = one(req.headers['x-kiorly-org-ref'])?.trim();
  if (!org || org.length > 64) throw new ApiError(401, 'PARTNER_UNAUTHORIZED', 'X-Kiorly-Org-Ref is required');
  return org;
}
