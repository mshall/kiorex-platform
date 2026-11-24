import { Injectable, Logger, Optional } from '@nestjs/common';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { AttributionPolicyResolver, type AttributionPolicyPayload } from '../attribution/policy';
import { AttributionService } from '../attribution/attribution.service';
import type { DecisionTouch } from '../attribution/decide';
import { applyKAnonymity } from '../analytics/kanon';
import { GROWTH_FAILURE, recordGrowthFailure } from '../growth-failures';
import { GROWTH_DEFAULT_MARKET, GROWTH_FLAG } from '../growth-flags';
import type { ContinuityHint, ProductAcquisitionBlockOut, ProductGrowthFactKind, ProductGrowthPort, ProductGrowthProduct } from '../growth-ports-public';
import { CrossProductService } from '../cross-product/continuity.service';
import { FACT_KIND_PRODUCT, continuityHash, decideProductFact, policyForProduct } from './product-decision';

type Fact = { product: ProductGrowthProduct; factKind: ProductGrowthFactKind; factId: string; sub: string; orgRef: string | null; createdAt: Date };
const iso = (d: Date) => d.toISOString();
const asTouch = (t: { id: string; kind: string; providerOrgRef: string | null; occurredAt: Date; dwellMs: number | null }): DecisionTouch => ({ id: t.id, kind: t.kind, providerOrgRef: t.providerOrgRef, occurredAt: iso(t.occurredAt), dwellMs: t.dwellMs });

/**
 * Kiorex product ingest and decision (GRW-P4-B2). The same pure `decide()` as the Clinic, run once per partner fact (pharmacy order, lab booking, care-plan booking) AFTER the fact exists:
 *  - never blocks the order or booking (flag OFF = no decision, no block, no change; a failure is logged at ERROR, counted, and repaired by `repair()` or lazily at submit);
 *  - append-only `GrowthProductDecision`, unique per (factKind, factId, policy version); a replay reproduces the stored decision from the stored touches;
 *  - evidence only from touches of a provider link of THIS product and THIS organisation (a Clinic link is never evidence for a pharmacy order, the registry's revoked or paused codes are dropped);
 *  - the commission link of products stays INERT (AD-13): the origin is recorded and sent to the partner, no charge exists and nothing here can create one;
 *  - no patient identifier, order line, test name or diagnosis is ever stored here (the fact id is an opaque Kiorex id; `sub` is used to read touches and is not written).
 */
@Injectable()
export class GrowthProductBookingService implements ProductGrowthPort {
  private readonly log = new Logger('product-growth');
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly policies: AttributionPolicyResolver, private readonly attribution: AttributionService, @Optional() private readonly cross?: CrossProductService) {}

  async decide(f: Fact & { visitorKey?: string | null; continuityParentBookingId?: string | null; continuity?: ContinuityHint | null }, market = GROWTH_DEFAULT_MARKET): Promise<{ id: string; origin: string; created: boolean } | null> {
    try { return await this.decideOrThrow(f, market); }
    catch (e) {
      recordGrowthFailure(GROWTH_FAILURE.PRODUCT_DECISION);
      this.log.error(`${GROWTH_FAILURE.PRODUCT_DECISION} ${f.factKind}=${f.factId} (the ${f.product.toLowerCase()} fact continues; repair will retry): ${(e as Error).message}`, (e as Error).stack);
      return null;
    }
  }

  /** Throws on infrastructure failure; returns null when the flag is OFF. Idempotent. */
  async decideOrThrow(f: Fact & { visitorKey?: string | null; continuityParentBookingId?: string | null; continuity?: ContinuityHint | null }, market = GROWTH_DEFAULT_MARKET) {
    if (FACT_KIND_PRODUCT[f.factKind] !== f.product) throw new TypeError('fact kind does not belong to the product');
    // a flag-check ERROR is not "flag OFF" (same rule as the clinic path): it propagates to the caller's catch, which counts and logs it
    if (!(await this.flags.isEnabled(GROWTH_FLAG.ATTRIBUTION, { market, ...(f.orgRef ? { orgId: f.orgRef } : {}) }))) return null;
    const { policy, payload } = await this.policies.decisionPolicy(market, f.createdAt);
    const cont = f.continuity && this.cross ? await this.cross.resolve({ product: f.product, sub: f.sub, createdAt: f.createdAt }, f.continuity, market).catch(() => null) : null; // GRW-P4-A: consent, flag, ownership and expiry are checked inside
    const parentBookingId = f.continuityParentBookingId ?? cont?.parentBookingId ?? null;
    const existing = await this.prisma.growthProductDecision.findFirst({ where: { factKind: f.factKind, factId: f.factId, policyVersionId: policy.versionId, supersedesId: null } });
    if (existing) {
      const parent = cont ? await this.parentDecision(parentBookingId, f.sub) : null;
      if (cont && parent) await this.cross!.recordLink({ cont, product: f.product, factId: f.factId, factCreatedAt: f.createdAt, decision: existing, parent: { decisionId: parent.id, origin: parent.origin }, market }); // idempotent: a link that failed the first time is written now
      return { id: existing.id, origin: existing.origin, created: false };
    }

    const fact = { product: f.product, factKind: f.factKind, factId: f.factId, orgRef: f.orgRef ?? '', createdAt: iso(f.createdAt) };
    const touches = await this.touchesOfProduct(f, policy, market);
    const d = decideProductFact(fact, touches.map(asTouch), policyForProduct(policy, payload as AttributionPolicyPayload & { products?: never }, f.product));
    let origin: string = d.origin; let reason: string = d.reasonCode; let parentDecisionId: string | null = null; let inputsHash = d.inputsHash;
    // ADR-056 (proposed): a fact created through a Kiorex continuity entry point of a clinic booking is CROSS_PRODUCT, linked to the clinic decision. Own evidence still wins for PROVIDER_LED.
    const parent = await this.parentDecision(parentBookingId, f.sub); // the parent must be the same person's booking: a forged parent id cannot link someone else's decision
    if (parent && d.origin !== 'PROVIDER_LED') {
      origin = 'CROSS_PRODUCT'; reason = 'CONTINUITY_ENTRY_POINT'; parentDecisionId = parent.id;
      inputsHash = continuityHash(fact, parent.id, parent.origin, policy.versionId);
    }
    try {
      const row = await this.prisma.growthProductDecision.create({ data: { market, product: f.product, factKind: f.factKind, factId: f.factId, origin, reasonCode: reason, policyVersionId: policy.versionId, inputsHash, evidenceTouchIds: d.consideredTouchIds, parentDecisionId } });
      if (cont && parent) await this.cross!.recordLink({ cont, product: f.product, factId: f.factId, factCreatedAt: f.createdAt, decision: row, parent: { decisionId: parent.id, origin: parent.origin }, market }); // never throws: counted and logged inside
      return { id: row.id, origin: row.origin, created: true };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') { // a concurrent request wrote it first
        const won = await this.prisma.growthProductDecision.findFirst({ where: { factKind: f.factKind, factId: f.factId, policyVersionId: policy.versionId, supersedesId: null } });
        if (won) return { id: won.id, origin: won.origin, created: false };
      }
      throw e;
    }
  }

  /** The newest clinic decision of a booking that belongs to this person (null for a missing, foreign or undecided booking). */
  private async parentDecision(bookingId: string | null, sub: string) {
    if (!bookingId) return null;
    const parent = await this.prisma.growthAttributionDecision.findFirst({ where: { bookingId, supersedesId: null }, orderBy: { createdAt: 'desc' } });
    if (!parent) return null;
    const booking = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId }, select: { sub: true } });
    return booking?.sub === sub ? parent : null;
  }

  /** Touches of the person, restricted to provider-owned evidence of THIS product (the clinic's own touch rules still apply: revoked codes dropped, withdrawal respected). */
  private async touchesOfProduct(f: Fact & { visitorKey?: string | null }, policy: Parameters<AttributionService['touchesFor']>[2], market: string) {
    const rows = await this.attribution.touchesFor({ sub: f.sub, createdAt: f.createdAt }, f.visitorKey ?? null, policy, market);
    const codes = [...new Set(rows.map((t) => t.linkCode).filter((c): c is string => !!c))];
    const sources = codes.length ? await this.prisma.growthAcquisitionSource.findMany({ where: { market, sourceKind: 'PROVIDER_LINK', sourceRef: { in: codes } }, select: { sourceRef: true, product: true, ownerOrgRef: true } }) : [];
    const own = new Set(sources.filter((s) => s.product === f.product && s.ownerOrgRef && s.ownerOrgRef === f.orgRef).map((s) => s.sourceRef));
    const providerKinds = ['PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET', 'OFFLINE'];
    // a provider touch counts only when its code is a link of this product and organisation; marketplace, referral and campaign touches are product-neutral
    return rows.filter((t) => !providerKinds.includes(t.kind) || (t.linkCode ? own.has(t.linkCode) : false));
  }

  async acquisitionBlock(f: Fact): Promise<ProductAcquisitionBlockOut | null> {
    try {
      let d = await this.latest(f.factKind, f.factId);
      if (!d) { await this.decide(f); d = await this.latest(f.factKind, f.factId); } // the earlier attempt failed or ran before the flag was on: decide now (idempotent)
      if (!d) return null;
      const winner = d.origin === 'PROVIDER_LED' && d.evidenceTouchIds.length ? await this.winningLinkCode(d.evidenceTouchIds, f) : undefined;
      // CROSS_PRODUCT is a Kiorex-side reporting origin; the partner contract knows three origins and a continuity fact is chargeable-class like marketplace (no charge exists today)
      const origin = d.origin === 'CROSS_PRODUCT' ? 'MARKETPLACE' : (d.origin as ProductAcquisitionBlockOut['origin']);
      const reason = d.origin === 'CROSS_PRODUCT' ? 'MARKETPLACE_TOUCH' : d.reasonCode; // the partner never learns that a continuity entry point exists (GRW-P4-A): a Kiorex-side reporting detail
      return { origin, decisionId: d.id, policyVersion: d.policyVersionId, reason, evidenceHash: d.inputsHash, ...(winner ? { linkCode: winner } : {}), product: f.product };
    } catch (e) { this.log.warn(`acquisition block for ${f.factKind}=${f.factId} failed (sent without it): ${(e as Error).message}`); return null; }
  }

  /** The newest decision of a fact (a correction supersedes the one it replaces). */
  async latest(factKind: string, factId: string) {
    const rows = await this.prisma.growthProductDecision.findMany({ where: { factKind, factId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
    return rows.filter((r) => !superseded.has(r.id)).pop() ?? null;
  }

  /** The link code of the latest eligible provider touch among the evidence (what the partner counts against). Only codes of this product and organisation. */
  private async winningLinkCode(touchIds: string[], f: Fact): Promise<string | undefined> {
    const rows = await this.prisma.growthTouchpoint.findMany({ where: { id: { in: touchIds }, linkCode: { not: null }, providerOrgRef: f.orgRef ?? '__none__' }, orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }], select: { linkCode: true } });
    return rows[0]?.linkCode ?? undefined;
  }

  /**
   * Repair job: facts created without a decision (the call failed, or the flag was off) get one. Idempotent; bounded per run. Returns counters only.
   * Pharmacy orders and lab bookings are read through the tables of the two modules (read-only), never through their services.
   */
  async repair(since: Date, limit = 200, market = GROWTH_DEFAULT_MARKET): Promise<{ scanned: number; decided: number; failed: number }> {
    const out = { scanned: 0, decided: 0, failed: 0 };
    const orgOf = async (registrationId: string | null) => registrationId ? (await this.prisma.partnerConnection.findFirst({ where: { registrationId }, select: { orgRef: true } }))?.orgRef ?? null : null;
    const orders = await this.prisma.pharmacyOrder.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true, sub: true, registrationId: true, createdAt: true } });
    const bookings = await this.prisma.labBooking.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true, sub: true, registrationId: true, createdAt: true } });
    const items = [...orders.map((o) => ({ ...o, product: 'PHARMACY' as const, factKind: 'ORDER' as const })), ...bookings.map((b) => ({ ...b, product: 'LAB' as const, factKind: 'LAB_BOOKING' as const }))];
    for (const i of items) {
      out.scanned += 1;
      if (await this.prisma.growthProductDecision.findFirst({ where: { factKind: i.factKind, factId: i.id }, select: { id: true } })) continue;
      const r = await this.decide({ product: i.product, factKind: i.factKind, factId: i.id, sub: i.sub, orgRef: await orgOf(i.registrationId), createdAt: i.createdAt }, market);
      if (r?.created) out.decided += 1; else if (!r) out.failed += 1;
    }
    return out;
  }

  /**
   * Counters for the ops view and the partner numbers: decisions per product and origin in the period, k-anonymity applied (cells under 10 are masked, with the secondary suppression).
   * Counts only; no fact id, no organisation, no person. A decision is a decision of Kiorex, not a charge: the commission link of products is inert.
   */
  async summary(days = 30, market = GROWTH_DEFAULT_MARKET) {
    const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000);
    const rows = await this.prisma.growthProductDecision.groupBy({ by: ['product', 'origin'], where: { market, createdAt: { gte: since }, supersedesId: null }, _count: { _all: true } });
    return { days, market, cells: applyKAnonymity(rows.map((r) => ({ key: `${r.product}:${r.origin}`, count: r._count._all }))), commissionLink: 'INERT' as const };
  }
}
