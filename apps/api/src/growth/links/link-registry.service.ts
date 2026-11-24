import { Injectable, Logger, Optional } from '@nestjs/common';
import { KiorlyClient, KiorlyHttpError } from '../../kiorly/kiorly-public';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';

/** CONFLICT: the code belongs to another organisation. REVOKED: the Clinic revoked (or paused) it, so it never decides a NEW booking. */
export type LinkLearnResult = 'REGISTERED' | 'KNOWN' | 'CONFLICT' | 'REVOKED';
export type LinkStatus = 'ACTIVE' | 'PAUSED' | 'REVOKED';
const CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const STATUSES: ReadonlySet<string> = new Set(['ACTIVE', 'PAUSED', 'REVOKED']);
/** A state the Clinic confirmed within this window is trusted without asking again (the events keep it fresh; the lookup repairs a missed one). */
const FRESH_MS = 5 * 60_000;

/**
 * Link registry (GRW-P1-C; ARCH 4.2 "a code nobody registered is ignored"; contracts 1.11.0). The Clinic owns link codes; Kiorex stores only
 * `GrowthAcquisitionSource(sourceKind PROVIDER_LINK, sourceRef = code, ownerOrgRef = org, linkStatus)`. Four ways the state arrives:
 *  1. `ReferralLinkCreated` (Clinic outbox, with the organisation reference): the code is known BEFORE its first token;
 *  2. `ReferralLinkRevoked`: the code stops deciding PROVIDER_LED for new bookings;
 *  3. a Clinic-signed `lt` carries `{org, code}`: a valid signature proves the Clinic issued the pair, so it is registered on first use;
 *  4. the signed Clinic lookup `GET /marketplace/v1/referral-links/{code}` (`confirm`) and the reconciliation feed (`reconcile`) repair a missed event.
 * A code belongs to one organisation only: a later claim for another organisation is a CONFLICT and is never honoured. Revocation can only REMOVE a fee: it never
 * touches a decision that was already written (append-only), it only keeps a still-valid 72 h token from deciding a new booking.
 */
@Injectable()
export class LinkRegistryService {
  private readonly log = new Logger('link-registry');
  constructor(private readonly prisma: PrismaService, @Optional() private readonly kiorly?: KiorlyClient) {}

  private where(code: string, market: string) { return { market_sourceKind_sourceRef: { market, sourceKind: 'PROVIDER_LINK', sourceRef: code } }; }

  async learn(code: string, orgRef: string, market = GROWTH_DEFAULT_MARKET): Promise<LinkLearnResult> {
    const c = code.toUpperCase();
    if (!CODE.test(c) || !orgRef) return 'CONFLICT';
    const where = this.where(c, market);
    const found = await this.prisma.growthAcquisitionSource.findUnique({ where });
    if (found) {
      if (found.ownerOrgRef && found.ownerOrgRef !== orgRef) return 'CONFLICT';
      if (!found.ownerOrgRef) await this.prisma.growthAcquisitionSource.updateMany({ where: { id: found.id, ownerOrgRef: null }, data: { ownerOrgRef: orgRef } });
      if (found.linkStatus !== 'ACTIVE') return 'REVOKED';
      return found.ownerOrgRef === orgRef ? 'KNOWN' : 'REGISTERED';
    }
    try {
      await this.prisma.growthAcquisitionSource.create({ data: { market, sourceKind: 'PROVIDER_LINK', sourceRef: c, ownerOrgRef: orgRef } });
      return 'REGISTERED';
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      const again = await this.prisma.growthAcquisitionSource.findUnique({ where });
      if (again?.ownerOrgRef !== orgRef) return 'CONFLICT';
      return again.linkStatus === 'ACTIVE' ? 'KNOWN' : 'REVOKED';
    }
  }

  async orgOf(code: string, market = GROWTH_DEFAULT_MARKET): Promise<string | null> {
    const src = await this.prisma.growthAcquisitionSource.findUnique({ where: this.where(code.toUpperCase(), market) });
    return src?.ownerOrgRef ?? null;
  }

  async statusOf(code: string, market = GROWTH_DEFAULT_MARKET): Promise<LinkStatus | null> {
    const src = await this.prisma.growthAcquisitionSource.findUnique({ where: this.where(code.toUpperCase(), market) });
    return src ? (src.linkStatus as LinkStatus) : null;
  }

  /** Apply a state reported by the Clinic. A claim for another organisation is ignored (CONFLICT); a code nobody registered yet is created with that state. */
  private async apply(code: string, orgRef: string, status: LinkStatus, at: Date, market: string, checked: boolean): Promise<LinkLearnResult> {
    const c = code.toUpperCase();
    if (!CODE.test(c) || !orgRef || !STATUSES.has(status)) return 'CONFLICT';
    const where = this.where(c, market);
    const data = { linkStatus: status, linkRevokedAt: status === 'REVOKED' ? at : null, ...(checked ? { registryCheckedAt: new Date() } : {}) };
    const found = await this.prisma.growthAcquisitionSource.findUnique({ where });
    if (found) {
      if (found.ownerOrgRef && found.ownerOrgRef !== orgRef) return 'CONFLICT';
      // a REVOKED code never comes back (the Clinic cannot change a revoked link): a late or replayed ACTIVE report must not reopen it
      if (found.linkStatus === 'REVOKED' && status !== 'REVOKED') return 'REVOKED';
      await this.prisma.growthAcquisitionSource.update({ where: { id: found.id }, data: { ...data, ...(found.ownerOrgRef ? {} : { ownerOrgRef: orgRef }) } });
      return status === 'ACTIVE' ? (found.ownerOrgRef === orgRef ? 'KNOWN' : 'REGISTERED') : 'REVOKED';
    }
    try {
      await this.prisma.growthAcquisitionSource.create({ data: { market, sourceKind: 'PROVIDER_LINK', sourceRef: c, ownerOrgRef: orgRef, ...data } });
      return status === 'ACTIVE' ? 'REGISTERED' : 'REVOKED';
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      return this.apply(code, orgRef, status, at, market, checked);
    }
  }

  private static orgFrom(data: Record<string, unknown>): string {
    return typeof data.orgRef === 'string' ? data.orgRef : typeof data.tenantId === 'string' ? data.tenantId : '';
  }

  /** `ReferralLinkCreated` from the Clinic (contracts 1.11.0 carries `orgRef`). Without a code and an organisation nothing can be learned. */
  async registerFromEvent(data: Record<string, unknown>, market = GROWTH_DEFAULT_MARKET): Promise<LinkLearnResult | 'IGNORED'> {
    const code = typeof data.linkCode === 'string' ? data.linkCode : '';
    const org = LinkRegistryService.orgFrom(data);
    if (!code || !org) return 'IGNORED';
    return this.learn(code, org, market);
  }

  /** `ReferralLinkRevoked` from the Clinic: the code stops deciding PROVIDER_LED for new bookings. Idempotent; an unknown code is recorded as revoked so a late token cannot register it. */
  async revokeFromEvent(data: Record<string, unknown>, market = GROWTH_DEFAULT_MARKET): Promise<LinkLearnResult | 'IGNORED'> {
    const code = typeof data.linkCode === 'string' ? data.linkCode : '';
    const org = LinkRegistryService.orgFrom(data);
    if (!code || !org) return 'IGNORED';
    const at = typeof data.revokedAt === 'string' && !Number.isNaN(Date.parse(data.revokedAt)) ? new Date(data.revokedAt) : new Date();
    return this.apply(code, org, 'REVOKED', at, market, false);
  }

  /**
   * Ask the Clinic (signed marketplace call) for the authoritative state of a code and store it. Used when the registry has never confirmed the code or the
   * confirmation is older than five minutes. Best effort: a Clinic that cannot be reached leaves the stored state in place (a verified token still proves the pair).
   */
  async confirm(code: string, orgRef: string, market = GROWTH_DEFAULT_MARKET): Promise<LinkLearnResult> {
    const c = code.toUpperCase();
    const stored = await this.prisma.growthAcquisitionSource.findUnique({ where: this.where(c, market) });
    if (stored?.linkStatus === 'REVOKED') return stored.ownerOrgRef && stored.ownerOrgRef !== orgRef ? 'CONFLICT' : 'REVOKED';
    if (stored?.registryCheckedAt && Date.now() - stored.registryCheckedAt.getTime() < FRESH_MS) return this.learn(c, orgRef, market);
    if (this.kiorly) {
      try {
        const r = await this.kiorly.referralLink(c);
        const rec = r.data;
        if (rec && rec.code?.toUpperCase() === c && rec.orgRef === orgRef) return this.apply(c, rec.orgRef, rec.status, rec.revokedAt ? new Date(rec.revokedAt) : new Date(), market, true);
        if (rec && rec.code?.toUpperCase() === c && rec.orgRef !== orgRef) return 'CONFLICT'; // the Clinic says the code belongs to someone else
      } catch (e) {
        if (!(e instanceof KiorlyHttpError && e.status === 404)) this.log.debug(`link lookup failed (${(e as Error).message}); keeping the stored state`);
      }
    }
    return this.learn(c, orgRef, market);
  }

  /**
   * Repair a missed event: read the Clinic feed of changes since `since` and apply every record. Returns the counters (no codes, no organisations). Safe to run often.
   */
  async reconcile(since?: Date, market = GROWTH_DEFAULT_MARKET): Promise<{ scanned: number; applied: number; conflicts: number }> {
    const out = { scanned: 0, applied: 0, conflicts: 0 };
    if (!this.kiorly) return out;
    let cursor: string | undefined;
    for (let page = 0; page < 200; page += 1) {
      const r = await this.kiorly.referralLinks({ ...(since ? { updatedSince: since.toISOString() } : {}), limit: 200, ...(cursor ? { cursor } : {}) });
      for (const rec of r.data.items ?? []) {
        out.scanned += 1;
        const res = await this.apply(rec.code, rec.orgRef, rec.status, rec.revokedAt ? new Date(rec.revokedAt) : new Date(), market, true);
        if (res === 'CONFLICT') out.conflicts += 1; else out.applied += 1;
      }
      cursor = r.data.nextCursor ?? undefined;
      if (!cursor) break;
    }
    return out;
  }
}
