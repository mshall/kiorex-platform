import { Injectable } from '@nestjs/common';
import { verifyKiorlyRequest } from '@kiorex/contracts';
import { createHash } from 'node:crypto';
import { cfg } from '../common/config';
import { ApiError, forbidden } from '../common/errors';
import { PgRateLimiter, SlidingWindowLimiter, type RateLimiter } from '../common/rate-limit';
import { ipHashOf } from '../common/privacy-hash';
import { PartnerRegistry } from '../partners/partners-public';
import { PrismaService } from '../prisma/prisma.service';
import { CommissionSettlementService } from './commission-settlement.service';

export type PartnerStatementReq = { ip?: string; originalUrl: string; method: string; rawBody?: Buffer; headers: Record<string, string | string[] | undefined>; query?: Record<string, unknown> };
export type PartnerStatementAuth = { orgRef: string; product: 'CLINIC' | 'PHARMACY' | 'LAB'; clientKey: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();
const lim = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };
const ORG_RE = /^[A-Za-z0-9_-]{3,64}$/;

/**
 * COM-3 / LG-COM-19: the settlement statement for a signed partner product (Clinic, Pharmacy, Lab), read only. The ops route (`/admin/commissions/settlement-statement`) answers any
 * organisation to an ops session; this one answers ONE organisation, and only the one the authenticated partner IS:
 *  - Pharmacy and Lab sign with their registered client key and webhook secret (PartnerRegistration, per partner): the organisation is the registration id, whatever the request says.
 *  - Clinic signs with the shared Clinic client key and webhook secret (same limit as growth evidence): the organisation is the tenant in `X-Kiorly-Org-Ref`, a claim by an authenticated
 *    Clinic, but never a registration id of another product.
 * A request that names a different organisation (header or `orgRef` query) is refused 403 PARTNER_ORG_MISMATCH and audited; a replayed nonce, a stale timestamp or a wrong key is 401.
 * Figures come from CommissionSettlementService, the same code as the ops route, so the two statements cannot drift.
 */
@Injectable()
export class CommissionPartnerStatementService {
  private readonly limiter: RateLimiter;
  constructor(private readonly prisma: PrismaService, private readonly partners: PartnerRegistry, private readonly settle: CommissionSettlementService) {
    this.limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new SlidingWindowLimiter() : new PgRateLimiter(prisma as never);
  }

  private async take(key: string, limit: number) {
    const r = await this.limiter.hit(`commission-statement:${key}`, limit, 60_000);
    if (!r.ok) throw new ApiError(429, 'PARTNER_RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec: r.retryAfterSec });
  }

  private async deny(who: Pick<PartnerStatementAuth, 'clientKey' | 'product'>, claimed: string | undefined, actual: string | null, reason: string): Promise<never> {
    await this.prisma.auditLog.create({ data: { actor: `partner:${who.clientKey}`, action: 'commission.partner_statement_denied', resource: 'CommissionStatement', resourceId: actual ?? undefined, metadata: { product: who.product, reason, claimed: claimed?.slice(0, 64) ?? null } } });
    throw forbidden('PARTNER_ORG_MISMATCH', 'A partner can only read the settlement statement of its own organisation');
  }

  async authenticate(req: PartnerStatementReq): Promise<PartnerStatementAuth> {
    await this.take(`ip:${ipHashOf(req.ip)}`, lim('COMMISSION_STATEMENT_RATE_IP_PER_MIN', 120)); // before any crypto or database lookup
    if (!req.headers['x-kiorly-signature']) throw new ApiError(401, 'UNAUTHENTICATED', 'A signed partner request is required');
    const clientKey = one(req.headers['x-kiorly-client-key']);
    const unauth = () => new ApiError(401, 'PARTNER_UNAUTHORIZED', 'Request could not be authenticated');
    if (!clientKey || clientKey.length > 200) throw unauth();
    const c = cfg();
    let secret: string | undefined; let product: PartnerStatementAuth['product'] = 'CLINIC'; let registrationId: string | null = null;
    if (clientKey === c.kiorlyClientKey) secret = c.kiorlyWebhookSecret;
    else {
      for (const kind of ['PHARMACY', 'LAB'] as const) {
        const a = await this.partners.webhookAuth(kind, clientKey);
        if (a) { secret = a.secret; product = kind; registrationId = a.registrationId; break; }
      }
    }
    if (!secret) throw unauth();
    const v = verifyKiorlyRequest({ headers: req.headers, method: req.method, path: req.originalUrl.split('?')[0]!, body: req.rawBody ?? Buffer.alloc(0), secret });
    if (!v.ok) throw unauth();
    const nonce = createHash('sha256').update(`commission-statement|${clientKey}|${one(req.headers['x-kiorly-nonce'])}`).digest('hex');
    try { await this.prisma.partnerIntakeNonce.create({ data: { id: nonce } }); } catch { throw unauth(); } // replay
    const claimedHeader = one(req.headers['x-kiorly-org-ref']);
    const claimedQuery = typeof req.query?.orgRef === 'string' ? req.query.orgRef.trim() : undefined;
    let orgRef: string;
    if (product === 'CLINIC') {
      if (!claimedHeader || !ORG_RE.test(claimedHeader)) throw new ApiError(401, 'PARTNER_UNAUTHORIZED', 'X-Kiorly-Org-Ref is required');
      if (await this.prisma.partnerRegistration.findUnique({ where: { id: claimedHeader }, select: { id: true } })) await this.deny({ clientKey, product }, claimedHeader, null, 'CLINIC_NAMED_PARTNER_REGISTRATION');
      orgRef = claimedHeader;
    } else {
      if (!registrationId) throw forbidden('PARTNER_ORG_UNKNOWN', 'This client is not a registered partner organisation'); // env-default dev credentials carry no organisation
      orgRef = registrationId;
      if (claimedHeader && claimedHeader !== orgRef) await this.deny({ clientKey, product }, claimedHeader, orgRef, 'HEADER_ORG_DIFFERS');
    }
    if (claimedQuery !== undefined && claimedQuery !== orgRef) await this.deny({ clientKey, product }, claimedQuery, orgRef, 'QUERY_ORG_DIFFERS');
    await this.take(`org:${product}:${orgRef}`, lim('COMMISSION_STATEMENT_RATE_PER_MIN', 30));
    return { orgRef, product, clientKey };
  }

  private async audit(a: PartnerStatementAuth, format: 'JSON' | 'CSV', o: { from?: string; to?: string }, rows?: number) {
    await this.prisma.auditLog.create({ data: { actor: `partner:${a.clientKey}`, action: format === 'CSV' ? 'commission.partner_statement_export' : 'commission.partner_statement_read', resource: 'CommissionStatement', resourceId: a.orgRef, metadata: { product: a.product, format, from: o.from ?? null, to: o.to ?? null, ...(rows !== undefined ? { rows } : {}) } } });
  }

  async statement(a: PartnerStatementAuth, o: { from?: string; to?: string }) { const s = await this.settle.statement(a.orgRef, o); await this.audit(a, 'JSON', o); return s; }
  async exportCsv(a: PartnerStatementAuth, o: { from?: string; to?: string }) { const r = await this.settle.exportCsv(a.orgRef, o); await this.audit(a, 'CSV', o, r.rows); return r; }
}
