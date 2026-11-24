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
exports.VerificationUpdateService = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../prisma/prisma.service");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const FIELDS = new Set(['LICENSE_NUMBER', 'SPECIALTY', 'ADDRESS', 'DISPLAY_NAME', 'PHOTO', 'DOCUMENT']);
const REF = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_ITEMS = 200;
let VerificationUpdateService = class VerificationUpdateService {
    prisma;
    kiorly;
    log = new common_1.Logger('verification-update');
    constructor(prisma, kiorly) {
        this.prisma = prisma;
        this.kiorly = kiorly;
    }
    items(human) {
        const h = (human ?? {});
        return h.verificationUpdates && typeof h.verificationUpdates === 'object' ? { ...h.verificationUpdates } : {};
    }
    async onRequested(data) {
        const requestRef = String(data.requestRef ?? '');
        const orgRef = String(data.orgRef ?? '');
        const field = String(data.field ?? '');
        if (!REF.test(requestRef) || !orgRef || !FIELDS.has(field))
            return 'IGNORED';
        const conn = await this.prisma.partnerConnection.findFirst({ where: { orgRef, kind: { in: ['CLINIC', 'NURSE'] } } });
        if (!conn) {
            this.log.warn(`verification update for unknown organisation ref=${requestRef}`);
            return 'IGNORED';
        }
        const items = this.items(conn.human);
        const prev = items[requestRef];
        if (Object.keys(items).length >= MAX_ITEMS && !prev)
            return 'IGNORED';
        items[requestRef] = { requestRef, clinicId: String(data.clinicId ?? '').slice(0, 120), field, evidenceCount: Math.min(10, Math.max(0, Number(data.evidenceCount) || 0)), requestedAt: typeof data.requestedAt === 'string' ? data.requestedAt : new Date().toISOString(), status: 'OPEN' };
        await this.prisma.partnerConnection.update({ where: { id: conn.id }, data: { human: { ...(conn.human ?? {}), verificationUpdates: items } } });
        await this.prisma.auditLog.create({ data: { actor: 'kiorly', action: 'partner_onboarding.verification_update_requested', resource: 'PartnerConnection', resourceId: conn.id, metadata: { requestRef, field, evidenceCount: items[requestRef].evidenceCount, reopened: !!prev } } });
        return 'APPLIED';
    }
    async list(q = {}) {
        const rows = await this.prisma.partnerConnection.findMany({ where: { kind: { in: ['CLINIC', 'NURSE'] } }, select: { id: true, name: true, orgRef: true, human: true }, take: 500 });
        const out = rows.flatMap((r) => Object.values(this.items(r.human)).map((i) => ({ ...i, connectionId: r.id, organisation: r.name, orgRef: r.orgRef })));
        return out.filter((i) => !q.status || i.status === q.status).sort((a, b) => (a.status === 'OPEN' ? 0 : 1) - (b.status === 'OPEN' ? 0 : 1) || (a.requestedAt < b.requestedAt ? 1 : -1)).slice(0, 200);
    }
    async find(requestRef) {
        if (!REF.test(requestRef))
            throw (0, errors_1.badRequest)('VERIFICATION_REF_INVALID', 'Invalid request reference');
        const rows = await this.prisma.partnerConnection.findMany({ where: { kind: { in: ['CLINIC', 'NURSE'] } }, take: 500 });
        for (const r of rows) {
            const item = this.items(r.human)[requestRef];
            if (item)
                return { conn: r, item };
        }
        throw (0, errors_1.notFound)('VERIFICATION_REQUEST_NOT_FOUND', 'No such verification update request');
    }
    async detail(requestRef) {
        const { conn, item } = await this.find(requestRef);
        let live = null;
        try {
            live = (await this.kiorly.request({ method: 'GET', path: `/provider-verification/requests/${encodeURIComponent(requestRef)}` })).data;
        }
        catch (e) {
            this.log.warn(`could not read request ${requestRef}: ${e.message}`);
        }
        return { ...item, connectionId: conn.id, organisation: conn.name, live };
    }
    async decide(actor, requestRef, decision, note) {
        if (!['APPROVED', 'REJECTED', 'NEEDS_INFO'].includes(decision))
            throw (0, errors_1.badRequest)('VERIFICATION_DECISION_INVALID', 'decision must be APPROVED, REJECTED or NEEDS_INFO');
        const clean = (note ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, 300);
        if (decision !== 'APPROVED' && clean.length < 5)
            throw (0, errors_1.badRequest)('VERIFICATION_NOTE_REQUIRED', 'A note of at least 5 characters is required to reject or ask for more information');
        const { conn, item } = await this.find(requestRef);
        if (item.status !== 'OPEN')
            throw new errors_1.ApiError(409, 'VERIFICATION_ALREADY_DECIDED', 'This request was already decided');
        const decidedAt = new Date().toISOString();
        const body = { requestRef, kiorexRef: `kxv_${requestRef.slice(-12)}`, orgRef: conn.orgRef, clinicId: item.clinicId, decision, ...(clean ? { note: clean } : {}), decidedAt };
        await this.kiorly.request({ method: 'POST', path: '/provider-verification/decisions', body });
        const items = this.items(conn.human);
        items[requestRef] = { ...item, status: decision, decidedAt, decidedBy: actor, ...(clean ? { note: clean } : {}) };
        await this.prisma.partnerConnection.update({ where: { id: conn.id }, data: { human: { ...(conn.human ?? {}), verificationUpdates: items } } });
        await this.prisma.auditLog.create({ data: { actor, action: 'partner_onboarding.verification_update_decided', resource: 'PartnerConnection', resourceId: conn.id, metadata: { requestRef, field: item.field, decision } } });
        return items[requestRef];
    }
};
exports.VerificationUpdateService = VerificationUpdateService;
exports.VerificationUpdateService = VerificationUpdateService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, kiorly_public_1.KiorlyClient])
], VerificationUpdateService);
//# sourceMappingURL=verification-update.consumer.js.map