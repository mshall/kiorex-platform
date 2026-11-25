"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrowthProductBookingService = void 0;
const common_1 = require("@nestjs/common");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const policy_1 = require("../attribution/policy");
const attribution_service_1 = require("../attribution/attribution.service");
const kanon_1 = require("../analytics/kanon");
const growth_failures_1 = require("../growth-failures");
const growth_flags_1 = require("../growth-flags");
const continuity_service_1 = require("../cross-product/continuity.service");
const product_decision_1 = require("./product-decision");
const iso = (d) => d.toISOString();
const asTouch = (t) => ({ id: t.id, kind: t.kind, providerOrgRef: t.providerOrgRef, occurredAt: iso(t.occurredAt), dwellMs: t.dwellMs });
let GrowthProductBookingService = class GrowthProductBookingService {
    prisma;
    flags;
    policies;
    attribution;
    cross;
    log = new common_1.Logger('product-growth');
    constructor(prisma, flags, policies, attribution, cross) {
        this.prisma = prisma;
        this.flags = flags;
        this.policies = policies;
        this.attribution = attribution;
        this.cross = cross;
    }
    async decide(f, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        try {
            return await this.decideOrThrow(f, market);
        }
        catch (e) {
            (0, growth_failures_1.recordGrowthFailure)(growth_failures_1.GROWTH_FAILURE.PRODUCT_DECISION);
            this.log.error(`${growth_failures_1.GROWTH_FAILURE.PRODUCT_DECISION} ${f.factKind}=${f.factId} (the ${f.product.toLowerCase()} fact continues; repair will retry): ${e.message}`, e.stack);
            return null;
        }
    }
    async decideOrThrow(f, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        if (product_decision_1.FACT_KIND_PRODUCT[f.factKind] !== f.product)
            throw new TypeError('fact kind does not belong to the product');
        if (!(await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.ATTRIBUTION, { market, ...(f.orgRef ? { orgId: f.orgRef } : {}) })))
            return null;
        const { policy, payload } = await this.policies.decisionPolicy(market, f.createdAt);
        const cont = f.continuity && this.cross ? await this.cross.resolve({ product: f.product, sub: f.sub, createdAt: f.createdAt }, f.continuity, market).catch(() => null) : null;
        const parentBookingId = f.continuityParentBookingId ?? cont?.parentBookingId ?? null;
        const existing = await this.prisma.growthProductDecision.findFirst({ where: { factKind: f.factKind, factId: f.factId, policyVersionId: policy.versionId, supersedesId: null } });
        if (existing) {
            const parent = cont ? await this.parentDecision(parentBookingId, f.sub) : null;
            if (cont && parent)
                await this.cross.recordLink({ cont, product: f.product, factId: f.factId, factCreatedAt: f.createdAt, decision: existing, parent: { decisionId: parent.id, origin: parent.origin }, market });
            return { id: existing.id, origin: existing.origin, created: false };
        }
        const fact = { product: f.product, factKind: f.factKind, factId: f.factId, orgRef: f.orgRef ?? '', createdAt: iso(f.createdAt) };
        const touches = await this.touchesOfProduct(f, policy, market);
        const d = (0, product_decision_1.decideProductFact)(fact, touches.map(asTouch), (0, product_decision_1.policyForProduct)(policy, payload, f.product));
        let origin = d.origin;
        let reason = d.reasonCode;
        let parentDecisionId = null;
        let inputsHash = d.inputsHash;
        const parent = await this.parentDecision(parentBookingId, f.sub);
        if (parent && d.origin !== 'PROVIDER_LED') {
            origin = 'CROSS_PRODUCT';
            reason = 'CONTINUITY_ENTRY_POINT';
            parentDecisionId = parent.id;
            inputsHash = (0, product_decision_1.continuityHash)(fact, parent.id, parent.origin, policy.versionId);
        }
        try {
            const row = await this.prisma.growthProductDecision.create({ data: { market, product: f.product, factKind: f.factKind, factId: f.factId, origin, reasonCode: reason, policyVersionId: policy.versionId, inputsHash, evidenceTouchIds: d.consideredTouchIds, parentDecisionId } });
            if (cont && parent)
                await this.cross.recordLink({ cont, product: f.product, factId: f.factId, factCreatedAt: f.createdAt, decision: row, parent: { decisionId: parent.id, origin: parent.origin }, market });
            return { id: row.id, origin: row.origin, created: true };
        }
        catch (e) {
            if (e.code === 'P2002') {
                const won = await this.prisma.growthProductDecision.findFirst({ where: { factKind: f.factKind, factId: f.factId, policyVersionId: policy.versionId, supersedesId: null } });
                if (won)
                    return { id: won.id, origin: won.origin, created: false };
            }
            throw e;
        }
    }
    async parentDecision(bookingId, sub) {
        if (!bookingId)
            return null;
        const parent = await this.prisma.growthAttributionDecision.findFirst({ where: { bookingId, supersedesId: null }, orderBy: { createdAt: 'desc' } });
        if (!parent)
            return null;
        const booking = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId }, select: { sub: true } });
        return booking?.sub === sub ? parent : null;
    }
    async touchesOfProduct(f, policy, market) {
        const rows = await this.attribution.touchesFor({ sub: f.sub, createdAt: f.createdAt }, f.visitorKey ?? null, policy, market);
        const codes = [...new Set(rows.map((t) => t.linkCode).filter((c) => !!c))];
        const sources = codes.length ? await this.prisma.growthAcquisitionSource.findMany({ where: { market, sourceKind: 'PROVIDER_LINK', sourceRef: { in: codes } }, select: { sourceRef: true, product: true, ownerOrgRef: true } }) : [];
        const own = new Set(sources.filter((s) => s.product === f.product && s.ownerOrgRef && s.ownerOrgRef === f.orgRef).map((s) => s.sourceRef));
        const providerKinds = ['PROVIDER_LINK', 'PROVIDER_QR', 'WIDGET', 'OFFLINE'];
        return rows.filter((t) => !providerKinds.includes(t.kind) || (t.linkCode ? own.has(t.linkCode) : false));
    }
    async acquisitionBlock(f) {
        try {
            let d = await this.latest(f.factKind, f.factId);
            if (!d) {
                await this.decide(f);
                d = await this.latest(f.factKind, f.factId);
            }
            if (!d)
                return null;
            const winner = d.origin === 'PROVIDER_LED' && d.evidenceTouchIds.length ? await this.winningLinkCode(d.evidenceTouchIds, f) : undefined;
            const origin = d.origin === 'CROSS_PRODUCT' ? 'MARKETPLACE' : d.origin;
            const reason = d.origin === 'CROSS_PRODUCT' ? 'MARKETPLACE_TOUCH' : d.reasonCode;
            return { origin, decisionId: d.id, policyVersion: d.policyVersionId, reason, evidenceHash: d.inputsHash, ...(winner ? { linkCode: winner } : {}), product: f.product };
        }
        catch (e) {
            this.log.warn(`acquisition block for ${f.factKind}=${f.factId} failed (sent without it): ${e.message}`);
            return null;
        }
    }
    async latest(factKind, factId) {
        const rows = await this.prisma.growthProductDecision.findMany({ where: { factKind, factId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
        return rows.filter((r) => !superseded.has(r.id)).pop() ?? null;
    }
    async winningLinkCode(touchIds, f) {
        const rows = await this.prisma.growthTouchpoint.findMany({ where: { id: { in: touchIds }, linkCode: { not: null }, providerOrgRef: f.orgRef ?? '__none__' }, orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }], select: { linkCode: true } });
        return rows[0]?.linkCode ?? undefined;
    }
    async repair(since, limit = 200, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const out = { scanned: 0, decided: 0, failed: 0 };
        const orgOf = async (registrationId) => registrationId ? (await this.prisma.partnerConnection.findFirst({ where: { registrationId }, select: { orgRef: true } }))?.orgRef ?? null : null;
        const orders = await this.prisma.pharmacyOrder.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true, sub: true, registrationId: true, createdAt: true } });
        const bookings = await this.prisma.labBooking.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true, sub: true, registrationId: true, createdAt: true } });
        const items = [...orders.map((o) => ({ ...o, product: 'PHARMACY', factKind: 'ORDER' })), ...bookings.map((b) => ({ ...b, product: 'LAB', factKind: 'LAB_BOOKING' }))];
        for (const i of items) {
            out.scanned += 1;
            if (await this.prisma.growthProductDecision.findFirst({ where: { factKind: i.factKind, factId: i.id }, select: { id: true } }))
                continue;
            const r = await this.decide({ product: i.product, factKind: i.factKind, factId: i.id, sub: i.sub, orgRef: await orgOf(i.registrationId), createdAt: i.createdAt }, market);
            if (r?.created)
                out.decided += 1;
            else if (!r)
                out.failed += 1;
        }
        return out;
    }
    async summary(days = 30, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000);
        const rows = await this.prisma.growthProductDecision.groupBy({ by: ['product', 'origin'], where: { market, createdAt: { gte: since }, supersedesId: null }, _count: { _all: true } });
        return { days, market, cells: (0, kanon_1.applyKAnonymity)(rows.map((r) => ({ key: `${r.product}:${r.origin}`, count: r._count._all }))), commissionLink: 'INERT' };
    }
};
exports.GrowthProductBookingService = GrowthProductBookingService;
exports.GrowthProductBookingService = GrowthProductBookingService = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, policy_1.AttributionPolicyResolver, attribution_service_1.AttributionService, continuity_service_1.CrossProductService])
], GrowthProductBookingService);
//# sourceMappingURL=product-decision.service.js.map