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
exports.PartnerEnrolmentService = exports.ENROLMENT_MAX_TTL_HOURS = exports.ENROLMENT_DEFAULT_TTL_HOURS = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../prisma/prisma.service");
const steps_1 = require("./steps");
exports.ENROLMENT_DEFAULT_TTL_HOURS = 24 * 7;
exports.ENROLMENT_MAX_TTL_HOURS = 24 * 14;
let PartnerEnrolmentService = class PartnerEnrolmentService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    audit(actor, action, id, metadata) {
        return this.prisma.auditLog.create({ data: { actor, action: `partner_enrolment.${action}`, resource: 'PartnerEnrolment', resourceId: id, metadata: metadata } });
    }
    view(e) {
        const status = e.status === 'ACTIVE' && e.expiresAt <= new Date() ? 'EXPIRED' : e.status;
        return { id: e.id, kind: e.kind, orgRef: e.orgRef, label: e.label, status, expiresAt: e.expiresAt, createdBy: e.createdBy, revokedBy: e.revokedBy, revokedAt: e.revokedAt, usedAt: e.usedAt, connectionId: e.connectionId, createdAt: e.createdAt };
    }
    async create(actor, i) {
        if (!steps_1.CONN_KINDS.includes(i.kind))
            throw (0, errors_1.badRequest)('INVALID_KIND', 'kind must be CLINIC, NURSE, PHARMACY or LAB');
        const label = (i.label ?? '').trim();
        if (label.length < 2 || label.length > 120)
            throw (0, errors_1.badRequest)('LABEL_REQUIRED', 'Say who this code is for (2 to 120 characters)');
        if (i.orgRef !== undefined && !/^[A-Za-z0-9_.:-]{1,80}$/.test(i.orgRef))
            throw (0, errors_1.badRequest)('INVALID_ORG_REF', 'orgRef is not valid');
        const ttl = i.ttlHours ?? exports.ENROLMENT_DEFAULT_TTL_HOURS;
        if (!Number.isFinite(ttl) || ttl < 1 || ttl > exports.ENROLMENT_MAX_TTL_HOURS)
            throw (0, errors_1.badRequest)('INVALID_TTL', `ttlHours must be 1 to ${exports.ENROLMENT_MAX_TTL_HOURS}`);
        const g = (0, contracts_1.generateEnrolmentCode)();
        const e = await this.prisma.partnerEnrolment.create({ data: { id: g.id, kind: i.kind, orgRef: i.orgRef || null, label, signingKey: g.signingKey, expiresAt: new Date(Date.now() + ttl * 3_600_000), createdBy: actor } });
        await this.audit(actor, 'created', e.id, { kind: e.kind, orgRef: e.orgRef, ttlHours: ttl });
        return { ...this.view(e), code: g.code, shownOnce: true };
    }
    async list(opts = {}) {
        const rows = await this.prisma.partnerEnrolment.findMany({ where: { ...(opts.kind ? { kind: opts.kind } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
        const v = rows.map((r) => this.view(r));
        return opts.status ? v.filter((x) => x.status === opts.status) : v;
    }
    async revoke(actor, id) {
        const e = await this.prisma.partnerEnrolment.findUnique({ where: { id } });
        if (!e)
            throw (0, errors_1.notFound)('ENROLMENT_NOT_FOUND', 'Enrolment code not found');
        if (e.status === 'USED')
            throw (0, errors_1.conflict)('ENROLMENT_USED', 'This code was already used');
        if (e.status === 'REVOKED')
            return this.view(e);
        const u = await this.prisma.partnerEnrolment.update({ where: { id }, data: { status: 'REVOKED', revokedBy: actor, revokedAt: new Date() } });
        await this.audit(actor, 'revoked', id);
        return this.view(u);
    }
};
exports.PartnerEnrolmentService = PartnerEnrolmentService;
exports.PartnerEnrolmentService = PartnerEnrolmentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PartnerEnrolmentService);
//# sourceMappingURL=partner-enrolment.service.js.map