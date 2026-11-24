import { DEFAULT_MARKET } from '../../market/market-core-public';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { conflict, forbidden, notFound, unprocessable } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { rolesFor } from '../admin/growth-access';
import { GrowthConfigService } from '../config/growth-config.service';
import { guardTexts } from './promotion-content-guard';
import { highValueReasons, reviewOutcome, type PromoFacts } from './promotion-math';
import { PROMOTION_RESERVATION_CLIENT, type PromotionReservationClient } from './promotion-reservation.client';

type Kind = 'CONTENT' | 'SCOPE' | 'HIGH_VALUE';
export interface ReviewActor { sub: string; roles: string[] }
const REVIEW_ROLES = rolesFor('reviewPromotions');
const kindsOf = (hv: boolean): Kind[] => (hv ? ['CONTENT', 'SCOPE', 'HIGH_VALUE'] : ['CONTENT', 'SCOPE']);
const requesterOf = (orgRef: string) => `org:${orgRef}`;

/**
 * Kiorex review of a provider-sponsored promotion (GRW-P2-S): the automated content guard first, then a human reviewer (Super Admin or a GROWTH_ADMIN) for the advertising wording and the scope; a HIGH_VALUE
 * promotion (thresholds in SPONSORED_PROMOTION_POLICY) also needs a SECOND, different approver. The decision travels to the Clinic as a signed command (`PromotionReviewDecided`); the Clinic
 * applies it with its own checks. Kiorex reviews content and scope only: it never edits a promotion and never touches the budget or the wallet (the Clinic owns both).
 */
@Injectable()
export class PromotionReviewService {
  constructor(private readonly prisma: PrismaService, private readonly config: GrowthConfigService, @Inject(PROMOTION_RESERVATION_CLIENT) private readonly clinic: PromotionReservationClient) {}

  private async policy(market = DEFAULT_MARKET) { return (await this.config.resolve<{ highValueBudgetMinor: number; highValuePerBookingMinor: number; maxDiscountBp: number }>('SPONSORED_PROMOTION_POLICY', { market })).payload; }

  /** Called when a projection reaches IN_REVIEW: opens the review rows (idempotent, one per kind) with the automated guard result attached. */
  async openReviews(promotionId: string, version: number): Promise<number> {
    const p = await this.prisma.sponsoredPromotionProjection.findUnique({ where: { promotionId_version: { promotionId, version } } });
    if (!p || p.status !== 'IN_REVIEW') return 0;
    const pol = await this.policy(p.market);
    const hv = highValueReasons({ budgetCapMinor: Number(p.budgetCapMinor), discount: p.discount as PromoFacts['discount'] }, pol).length > 0;
    const guard = guardTexts({ nameEn: p.nameEn, nameAr: p.nameAr, patientCopyEn: p.patientCopyEn, patientCopyAr: p.patientCopyAr });
    let n = 0;
    for (const kind of kindsOf(hv)) {
      const exists = await this.prisma.sponsoredPromotionReview.findFirst({ where: { promotionId, promotionVersion: version, kind }, select: { id: true } });
      if (!exists) { await this.prisma.sponsoredPromotionReview.create({ data: { market: p.market, promotionId, promotionVersion: version, kind, requestedBy: requesterOf(p.orgRef), guardResult: guard as unknown as Prisma.InputJsonValue } }); n++; }
    }
    return n;
  }

  async queue(o: { status?: 'IN_REVIEW' | 'ACTIVE' | 'ALL'; take?: number } = {}) {
    const rows = await this.prisma.sponsoredPromotionProjection.findMany({ where: o.status === 'ALL' ? {} : { status: o.status ?? 'IN_REVIEW' }, orderBy: [{ lastEventAt: 'desc' }], take: Math.min(o.take ?? 100, 200) });
    const reviews = await this.prisma.sponsoredPromotionReview.findMany({ where: { OR: rows.map((r) => ({ promotionId: r.promotionId, promotionVersion: r.version })) }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ promotionId: r.promotionId, version: r.version, orgRef: r.orgRef, status: r.status, nameAr: r.nameAr, nameEn: r.nameEn, budgetCapMinor: Number(r.budgetCapMinor), updatedAt: r.lastEventAt, reviews: reviews.filter((x) => x.promotionId === r.promotionId && x.promotionVersion === r.version).map((x) => ({ kind: x.kind, decision: x.decision, decidedBy: x.decidedBy ? 'ops' : null, decidedAt: x.decidedAt })) }));
  }

  async detail(promotionId: string, version?: number) {
    const p = await this.prisma.sponsoredPromotionProjection.findFirst({ where: { promotionId, ...(version ? { version } : {}) }, orderBy: { version: 'desc' } });
    if (!p) throw notFound('PROMOTION_NOT_FOUND', 'Promotion not found');
    const pol = await this.policy(p.market);
    const reviews = await this.prisma.sponsoredPromotionReview.findMany({ where: { promotionId, promotionVersion: p.version }, orderBy: { createdAt: 'asc' } });
    return {
      promotionId, version: p.version, orgRef: p.orgRef, status: p.status, nameAr: p.nameAr, nameEn: p.nameEn, patientCopyAr: p.patientCopyAr, patientCopyEn: p.patientCopyEn, scope: p.scope, discount: p.discount, eligibility: p.eligibility,
      budgetCapMinor: Number(p.budgetCapMinor), fundingMode: p.fundingMode, startsAt: p.startsAt, endsAt: p.endsAt, contentHash: p.contentHash,
      highValue: highValueReasons({ budgetCapMinor: Number(p.budgetCapMinor), discount: p.discount as PromoFacts['discount'] }, pol),
      guard: guardTexts({ nameEn: p.nameEn, nameAr: p.nameAr, patientCopyEn: p.patientCopyEn, patientCopyAr: p.patientCopyAr }),
      reviews: reviews.map((r) => ({ id: r.id, kind: r.kind, decision: r.decision, reason: r.reason, decidedAt: r.decidedAt, mine: false, guardResult: r.guardResult })),
    };
  }

  async decide(a: ReviewActor, promotionId: string, i: { version: number; kind: Kind; decision: 'APPROVED' | 'REJECTED' | 'NEEDS_CHANGES'; note?: string }) {
    if (!a.roles.some((r) => REVIEW_ROLES.includes(r))) throw forbidden('REVIEW_ROLE_REQUIRED', 'Only a Super Admin or a growth admin reviews promotions');
    const p = await this.prisma.sponsoredPromotionProjection.findUnique({ where: { promotionId_version: { promotionId, version: i.version } } });
    if (!p) throw notFound('PROMOTION_NOT_FOUND', 'Promotion not found');
    if (p.status !== 'IN_REVIEW') throw conflict('PROMOTION_NOT_IN_REVIEW', `The promotion is ${p.status}`);
    await this.openReviews(promotionId, i.version);
    const rows = await this.prisma.sponsoredPromotionReview.findMany({ where: { promotionId, promotionVersion: i.version } });
    const row = rows.find((r) => r.kind === i.kind); if (!row) throw notFound('REVIEW_NOT_OPEN', 'No such review is open for this version');
    if (row.decision) { if (row.decision === i.decision && row.decidedBy === a.sub) return this.detail(promotionId, i.version); throw conflict('REVIEW_ALREADY_DECIDED', 'This review is already decided'); }
    if (row.requestedBy === a.sub) throw forbidden('SELF_APPROVAL', 'The author cannot approve their own promotion'); // never true for an org requester; kept as the DB CHECK's twin
    // maker-checker: the HIGH_VALUE approver is a different person from the CONTENT and SCOPE approvers (and the other way round)
    if (i.decision === 'APPROVED' && i.kind === 'HIGH_VALUE' && rows.some((r) => r.kind !== 'HIGH_VALUE' && r.decidedBy === a.sub)) throw forbidden('SECOND_APPROVER_REQUIRED', 'A high-value promotion needs a second approver who is not the first');
    if (i.decision === 'APPROVED' && i.kind !== 'HIGH_VALUE' && rows.some((r) => r.kind === 'HIGH_VALUE' && r.decidedBy === a.sub)) throw forbidden('SECOND_APPROVER_REQUIRED', 'The second approver cannot also decide the content or scope');
    if (i.decision === 'APPROVED' && i.kind === 'CONTENT') { const g = guardTexts({ nameEn: p.nameEn, nameAr: p.nameAr, patientCopyEn: p.patientCopyEn, patientCopyAr: p.patientCopyAr }); if (!g.ok) throw unprocessable('GUARD_BLOCKS_APPROVAL', 'The automated content guard found wording that cannot be approved', { hits: g.hits }); }
    const note = (i.note ?? '').trim().slice(0, 300);
    if ((i.decision !== 'APPROVED') && !note) throw unprocessable('NOTE_REQUIRED', 'A rejection or a request for changes needs a short reason');
    const sent = await this.clinic.reviewDecision({ promotionId, clinicId: await this.clinicOf(p.orgRef), version: i.version, reviewKind: i.kind, decision: i.decision, note: note || undefined, decidedBy: `ops:${a.sub}` });
    if (sent === 'UNAVAILABLE') throw unprocessable('CLINIC_UNAVAILABLE', 'The clinic system is busy; the decision was not sent. Try again.');
    if (typeof sent === 'object') throw conflict('CLINIC_REFUSED_DECISION', 'The clinic refused the decision', { clinicCode: sent.refused });
    await this.prisma.sponsoredPromotionReview.updateMany({ where: { id: row.id, decision: null }, data: { decision: i.decision, decidedBy: a.sub, reason: note || null, decidedAt: new Date() } });
    const after = await this.prisma.sponsoredPromotionReview.findMany({ where: { promotionId, promotionVersion: i.version } });
    const pol = await this.policy(p.market);
    const required = kindsOf(highValueReasons({ budgetCapMinor: Number(p.budgetCapMinor), discount: p.discount as PromoFacts['discount'] }, pol).length > 0);
    await this.prisma.auditLog.create({ data: { actor: a.sub, action: `growth.promotion_review.${i.kind.toLowerCase()}.${i.decision.toLowerCase()}`, resource: 'SponsoredPromotionReview', resourceId: row.id, metadata: { promotionId, version: i.version, outcome: reviewOutcome(required, after) } as Prisma.InputJsonValue } });
    return this.detail(promotionId, i.version);
  }

  private async clinicOf(orgRef: string): Promise<string> {
    const prov = await this.prisma.provider.findFirst({ where: { tenantId: orgRef }, select: { clinicId: true } });
    if (!prov) throw conflict('NO_CLINIC_FOR_ORG', 'No clinic is known for this organisation');
    return prov.clinicId;
  }
}
