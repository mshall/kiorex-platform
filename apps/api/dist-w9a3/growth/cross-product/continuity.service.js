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
exports.CrossProductService = exports.CROSS_PRODUCT_FAILURE = exports.CROSS_PRODUCT_CONSENT = void 0;
const common_1 = require("@nestjs/common");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const patient_public_1 = require("../../patient/patient-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const growth_failures_1 = require("../growth-failures");
const continuity_refs_1 = require("./continuity-refs");
const continuity_rules_1 = require("./continuity-rules");
exports.CROSS_PRODUCT_CONSENT = 'CROSS_PRODUCT_CONTINUITY';
exports.CROSS_PRODUCT_FAILURE = { LINK: 'growth.cross_product.link_failed', ENTRY: 'growth.cross_product.entry_failed' };
const DAY = 86_400_000;
let CrossProductService = class CrossProductService {
    prisma;
    flags;
    consents;
    log = new common_1.Logger('cross-product');
    constructor(prisma, flags, consents) {
        this.prisma = prisma;
        this.flags = flags;
        this.consents = consents;
    }
    async isOn(market = growth_flags_1.GROWTH_DEFAULT_MARKET) { try {
        return await this.flags.isEnabled(continuity_rules_1.FLAG_CROSS_PRODUCT, { market });
    }
    catch {
        return false;
    } }
    async gatesOpen(kind, market) {
        for (const k of continuity_rules_1.ENTRY_META[kind].gateFlags) {
            if (!(await this.flags.isEnabled(k, { market }).catch(() => false)))
                return false;
        }
        return true;
    }
    async consentState(sub) {
        const s = (await this.consents.states(sub, [exports.CROSS_PRODUCT_CONSENT])).get(exports.CROSS_PRODUCT_CONSENT);
        return { granted: s.granted, textVersion: s.version, updatedAt: s.updatedAt?.toISOString() ?? null, draftWording: !s.version || s.version === patient_public_1.CONSENT_TEXT_PLACEHOLDER };
    }
    async setConsent(sub, granted, source) {
        await this.consents.setConsent(sub, exports.CROSS_PRODUCT_CONSENT, granted, { source });
        if (!granted)
            await this.prisma.crossProductEntryPoint.updateMany({ where: { sub, consumedAt: null }, data: { dismissedAt: new Date() } });
        return this.consentState(sub);
    }
    async offer(i, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        try {
            const meta = continuity_rules_1.ENTRY_META[i.kind];
            const parent = i.parentBookingId !== undefined ? i.parentBookingId : await this.parentFor(i.sub, i.at, meta.lookbackDays, i.clinicId);
            const ref = (0, continuity_refs_1.factRef)(i.factKind, i.fact);
            const expiresAt = new Date(Math.max(i.at.getTime(), Date.now()) + meta.ttlDays * DAY);
            const row = await this.prisma.crossProductEntryPoint.upsert({ where: { sub_kind_factRef: { sub: i.sub, kind: i.kind, factRef: ref } }, create: { market, sub: i.sub, kind: i.kind, factRef: ref, parentBookingId: parent, expiresAt }, update: {} });
            return row.id;
        }
        catch (e) {
            (0, growth_failures_1.recordGrowthFailure)(exports.CROSS_PRODUCT_FAILURE.ENTRY);
            this.log.warn(`${exports.CROSS_PRODUCT_FAILURE.ENTRY} kind=${i.kind}: ${e.message}`);
            return null;
        }
    }
    async parentFor(sub, at, lookbackDays, clinicId) {
        const rows = await this.prisma.bookingIntent.findMany({ where: { sub, dependantId: null, status: { in: ['COMPLETED', 'CHECKED_IN'] }, startsAt: { gte: new Date(at.getTime() - lookbackDays * DAY), lte: new Date(at.getTime() + DAY) } }, select: { id: true, clinicId: true, startsAt: true, status: true, dependantId: true }, orderBy: { startsAt: 'desc' }, take: 20 });
        return (0, continuity_rules_1.pickParent)(rows, { at, lookbackDays, clinicId })?.id ?? null;
    }
    async dismiss(sub, id) {
        const r = await this.prisma.crossProductEntryPoint.updateMany({ where: { id, sub, dismissedAt: null }, data: { dismissedAt: new Date() } });
        return { dismissed: r.count > 0 };
    }
    async cards(sub, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const consent = (await this.consentState(sub)).granted;
        if (!(await this.isOn(market)))
            return { enabled: false, consent, cards: [] };
        if (await this.gatesOpen('CARE_PLAN_TO_HOME_VISIT', market))
            await this.ensureHomePrompt(sub, market);
        const now = new Date();
        const rows = await this.prisma.crossProductEntryPoint.findMany({ where: { sub, expiresAt: { gt: now }, consumedAt: null, dismissedAt: null }, orderBy: { createdAt: 'desc' }, take: 20 });
        const cards = [];
        for (const r of rows) {
            const kind = r.kind;
            const meta = continuity_rules_1.ENTRY_META[kind];
            if (!meta || !(await this.gatesOpen(kind, market)))
                continue;
            let recordId;
            if (kind === 'RX_TO_PHARMACY') {
                const rec = await this.activePrescriptionFor(sub, r.factRef);
                if (!rec)
                    continue;
                if (await this.prisma.pharmacyOrder.findFirst({ where: { sub, prescriptionRecordId: rec }, select: { id: true } }))
                    continue;
                recordId = rec;
            }
            cards.push({ id: r.id, kind, toProduct: meta.toProduct, expiresAt: r.expiresAt.toISOString(), ...(recordId ? { recordId } : {}), path: meta.cta });
        }
        return { enabled: true, consent, cards };
    }
    async ensureHomePrompt(sub, market) {
        const meta = continuity_rules_1.ENTRY_META.CARE_PLAN_TO_HOME_VISIT;
        const visit = await this.prisma.bookingIntent.findFirst({ where: { sub, dependantId: null, status: 'COMPLETED', startsAt: { gte: new Date(Date.now() - meta.lookbackDays * DAY) } }, orderBy: { startsAt: 'desc' }, select: { id: true, startsAt: true } });
        if (visit)
            await this.offer({ sub, kind: 'CARE_PLAN_TO_HOME_VISIT', fact: visit.id, factKind: 'CLINIC_BOOKING', at: visit.startsAt, parentBookingId: visit.id }, market);
    }
    async activePrescriptionFor(sub, ref) {
        const recs = await this.prisma.sharedRecord.findMany({ where: { sub, kind: 'PRESCRIPTION', status: 'ACTIVE' }, select: { id: true, sourceRef: true }, orderBy: { createdAt: 'desc' }, take: 100 });
        return recs.find((r) => r.sourceRef && (0, continuity_refs_1.factRef)('RX', r.sourceRef) === ref)?.id ?? null;
    }
    async resolve(f, hint, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        if (!hint.entryId && !hint.recordId)
            return null;
        if (!(await this.isOn(market)))
            return null;
        if (!(await this.consentState(f.sub)).granted)
            return null;
        const kind = (0, continuity_rules_1.entryKindOfProduct)(f.product);
        const now = new Date();
        let entry = hint.entryId ? await this.prisma.crossProductEntryPoint.findFirst({ where: { id: hint.entryId, sub: f.sub, kind, expiresAt: { gt: now }, dismissedAt: null } }) : null;
        let parentBookingId = entry?.parentBookingId ?? null;
        if (!entry && hint.recordId && kind === 'RX_TO_PHARMACY') {
            const rec = await this.prisma.sharedRecord.findFirst({ where: { id: hint.recordId, sub: f.sub, kind: 'PRESCRIPTION', status: 'ACTIVE' }, select: { sourceRef: true, clinicId: true, signedAt: true, createdAt: true } });
            if (!rec?.sourceRef)
                return null;
            entry = await this.prisma.crossProductEntryPoint.findFirst({ where: { sub: f.sub, kind, factRef: (0, continuity_refs_1.factRef)('RX', rec.sourceRef), expiresAt: { gt: now }, dismissedAt: null } });
            parentBookingId = entry?.parentBookingId ?? (await this.parentFor(f.sub, rec.signedAt ?? rec.createdAt, continuity_rules_1.ENTRY_META.RX_TO_PHARMACY.lookbackDays, rec.clinicId));
        }
        if (hint.entryId && !entry)
            return null;
        if (!parentBookingId)
            return null;
        const parent = await this.prisma.bookingIntent.findFirst({ where: { id: parentBookingId, sub: f.sub, dependantId: null }, select: { id: true, startsAt: true } });
        if (!parent)
            return null;
        return { entryId: entry?.id ?? null, kind, parentBookingId: parent.id, parentStartsAt: parent.startsAt };
    }
    verdict(own, parent) {
        return (0, continuity_rules_1.evaluateContinuity)({ flagOn: true, consent: true, hasParent: !!parent, ownOrigin: own.origin, parentOrigin: parent?.origin ?? null });
    }
    async recordLink(i) {
        try {
            const v = this.verdict(i.decision, { origin: i.parent.origin });
            if (!v.linked)
                return false;
            try {
                await this.prisma.crossProductContinuity.create({ data: {
                        market: i.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET, toProduct: i.product, entryPoint: i.cont.kind, fromFactRef: (0, continuity_refs_1.factRef)('CLINIC_BOOKING', i.cont.parentBookingId), toFactRef: (0, continuity_refs_1.factRef)(i.product === 'PHARMACY' ? 'PHARMACY_ORDER' : i.product === 'LAB' ? 'LAB_BOOKING' : 'CARE_PLAN', i.factId),
                        decisionId: i.decision.id, parentDecisionId: i.parent.decisionId, parentOrigin: (0, continuity_rules_1.asClinicOrigin)(i.parent.origin), toOrigin: i.decision.origin, lagHours: (0, continuity_rules_1.lagHoursBetween)(i.cont.parentStartsAt, i.factCreatedAt),
                    } });
            }
            catch (e) {
                if (e.code !== 'P2002')
                    throw e;
            }
            if (i.cont.entryId)
                await this.prisma.crossProductEntryPoint.updateMany({ where: { id: i.cont.entryId, consumedAt: null }, data: { consumedAt: new Date() } });
            return true;
        }
        catch (e) {
            (0, growth_failures_1.recordGrowthFailure)(exports.CROSS_PRODUCT_FAILURE.LINK);
            this.log.error(`${exports.CROSS_PRODUCT_FAILURE.LINK} product=${i.product} (the ${i.product.toLowerCase()} fact continues): ${e.message}`, e.stack);
            return false;
        }
    }
    async purgeExpired(now = new Date()) {
        const r = await this.prisma.crossProductEntryPoint.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 60 * DAY) } } });
        return { purged: r.count };
    }
    async exportFor(sub) {
        const rows = await this.prisma.crossProductEntryPoint.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 200, select: { kind: true, createdAt: true, expiresAt: true, consumedAt: true, dismissedAt: true } });
        return { consent: await this.consentState(sub), prompts: rows };
    }
    async eraseSubject(sub) {
        const r = await this.prisma.crossProductEntryPoint.deleteMany({ where: { sub } });
        return { entryPointsDeleted: r.count };
    }
};
exports.CrossProductService = CrossProductService;
exports.CrossProductService = CrossProductService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.ConsentService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, patient_public_1.ConsentService])
], CrossProductService);
//# sourceMappingURL=continuity.service.js.map