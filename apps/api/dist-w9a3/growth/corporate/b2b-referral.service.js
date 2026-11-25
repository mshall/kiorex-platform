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
Object.defineProperty(exports, "__esModule", { value: true });
exports.B2bReferralService = exports.SIZE_BUCKETS = exports.LEAD_TRANSITIONS = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const corporate_privacy_1 = require("./corporate-privacy");
exports.LEAD_TRANSITIONS = {
    NEW: ['CONTACTED', 'DUPLICATE', 'LOST'], CONTACTED: ['QUALIFIED', 'LOST'], QUALIFIED: ['PROPOSAL', 'LOST'], PROPOSAL: ['WON', 'LOST'], LOST: ['CONTACTED'], WON: [], DUPLICATE: [],
};
exports.SIZE_BUCKETS = ['1_49', '50_199', '200_999', '1000_PLUS', 'UNKNOWN'];
const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
let B2bReferralService = class B2bReferralService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async ingestFromClinic(data) {
        const ref = typeof data.referralId === 'string' ? data.referralId : '';
        const name = typeof data.companyName === 'string' ? data.companyName.trim() : '';
        if (!ref || name.length < 2 || name.length > 120 || (0, corporate_privacy_1.looksPersonal)(name))
            return 'IGNORED';
        const orgRef = typeof data.orgRef === 'string' ? data.orgRef : typeof data.tenantId === 'string' ? data.tenantId : null;
        const contactRef = typeof data.contactRef === 'string' && data.contactRef.length <= 80 && !(0, corporate_privacy_1.looksPersonal)(data.contactRef) ? data.contactRef : null;
        const size = exports.SIZE_BUCKETS.includes(data.sizeBucket) ? data.sizeBucket : 'UNKNOWN';
        const dup = await this.prisma.corporateLead.findMany({ where: { status: { notIn: ['LOST', 'DUPLICATE'] } }, select: { id: true, companyName: true }, take: 2000 });
        const same = dup.find((d) => norm(d.companyName) === norm(name));
        try {
            await this.prisma.$transaction(async (tx) => {
                const lead = await tx.corporateLead.create({ data: { market: growth_flags_1.GROWTH_DEFAULT_MARKET, source: 'B2B_REFERRAL', referrerOrgRef: orgRef, referralRef: ref, companyName: name, sizeBucket: size, contactRef, status: same ? 'DUPLICATE' : 'NEW', notes: same ? `Possible duplicate of lead ${same.id}` : '' } });
                await tx.corporateLeadHistory.create({ data: { leadId: lead.id, toStatus: lead.status, actor: 'system:clinic-referral', note: same ? `duplicate of ${same.id}` : null } });
            });
        }
        catch (e) {
            if (!/Unique constraint/.test(e.message))
                throw e;
        }
        return 'APPLIED';
    }
    async create(actor, i) {
        const name = i.companyName?.trim();
        if (!name || name.length < 2 || name.length > 120)
            throw (0, errors_1.badRequest)('INVALID_INPUT', 'companyName must be 2..120 characters');
        this.assertCompanyText(name, i.contactRef, i.notes);
        const lead = await this.prisma.$transaction(async (tx) => {
            const l = await tx.corporateLead.create({ data: { source: i.source ?? 'OUTBOUND', companyName: name, sizeBucket: exports.SIZE_BUCKETS.includes(i.sizeBucket ?? '') ? i.sizeBucket : 'UNKNOWN', contactRef: i.contactRef ?? null, notes: i.notes ?? '', ownerSub: actor.sub } });
            await tx.corporateLeadHistory.create({ data: { leadId: l.id, toStatus: 'NEW', actor: actor.sub } });
            return l;
        });
        return this.view(lead);
    }
    assertCompanyText(name, contactRef, notes) {
        if ((0, corporate_privacy_1.looksPersonal)(name) || (0, corporate_privacy_1.looksPersonal)(contactRef ?? '') || (0, corporate_privacy_1.looksPersonal)(notes ?? ''))
            throw (0, errors_1.unprocessable)('CORPORATE_PERSONAL_DATA', 'Leads hold company data only: use an opaque contact reference, never a name, phone or e-mail of a person');
        if ((contactRef ?? '').length > 80 || (notes ?? '').length > 2000)
            throw (0, errors_1.badRequest)('INVALID_INPUT', 'contactRef is at most 80 and notes at most 2000 characters');
    }
    async list(q = {}) {
        const rows = await this.prisma.corporateLead.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.source ? { source: q.source } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(q.take ?? 100, 1), 200) });
        const grouped = await this.prisma.corporateLead.groupBy({ by: ['status'], _count: { _all: true } });
        return { items: rows.map((r) => this.view(r)), pipeline: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) };
    }
    async get(id) {
        const l = await this.prisma.corporateLead.findUnique({ where: { id }, include: { history: { orderBy: { at: 'asc' } } } });
        if (!l)
            throw (0, errors_1.notFound)('CORPORATE_LEAD_NOT_FOUND', 'Lead not found');
        return { ...this.view(l), history: l.history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actor: h.actor, note: h.note, at: h.at.toISOString() })) };
    }
    async transition(actor, id, to, note) {
        const l = await this.prisma.corporateLead.findUnique({ where: { id } });
        if (!l)
            throw (0, errors_1.notFound)('CORPORATE_LEAD_NOT_FOUND', 'Lead not found');
        if (!(exports.LEAD_TRANSITIONS[l.status] ?? []).includes(to))
            throw (0, errors_1.conflict)('CORPORATE_LEAD_TRANSITION', `A ${l.status} lead cannot become ${to}`);
        if (note && ((0, corporate_privacy_1.looksPersonal)(note) || note.length > 500))
            throw (0, errors_1.unprocessable)('CORPORATE_PERSONAL_DATA', 'Notes describe the company only (at most 500 characters, no personal contact data)');
        const u = await this.prisma.$transaction(async (tx) => {
            const row = await tx.corporateLead.update({ where: { id }, data: { status: to, ownerSub: l.ownerSub ?? actor.sub } });
            await tx.corporateLeadHistory.create({ data: { leadId: id, fromStatus: l.status, toStatus: to, actor: actor.sub, note: note ?? null } });
            return row;
        });
        return this.view(u);
    }
    async assign(actor, id, ownerSub) {
        if (!ownerSub || ownerSub.length > 80)
            throw (0, errors_1.badRequest)('INVALID_INPUT', 'ownerSub is required');
        try {
            return this.view(await this.prisma.corporateLead.update({ where: { id }, data: { ownerSub } }));
        }
        catch (e) {
            if (e.code === 'P2025')
                throw (0, errors_1.notFound)('CORPORATE_LEAD_NOT_FOUND', 'Lead not found');
            throw e;
        }
    }
    async setNotes(actor, id, notes) {
        this.assertCompanyText('x', null, notes);
        try {
            return this.view(await this.prisma.corporateLead.update({ where: { id }, data: { notes } }));
        }
        catch (e) {
            if (e.code === 'P2025')
                throw (0, errors_1.notFound)('CORPORATE_LEAD_NOT_FOUND', 'Lead not found');
            throw e;
        }
    }
    view(l) {
        return { id: l.id, market: l.market, source: l.source, referrerOrgRef: l.referrerOrgRef, companyName: l.companyName, sizeBucket: l.sizeBucket, contactRef: l.contactRef, status: l.status, ownerSub: l.ownerSub, notes: l.notes, accountId: l.accountId, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString() };
    }
};
exports.B2bReferralService = B2bReferralService;
exports.B2bReferralService = B2bReferralService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], B2bReferralService);
//# sourceMappingURL=b2b-referral.service.js.map