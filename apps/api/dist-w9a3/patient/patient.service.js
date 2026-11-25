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
exports.PatientService = exports.CONSENT_VERSION = exports.CONSENT_PURPOSES = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const auth_public_1 = require("../auth/auth-public");
const market_public_1 = require("../market/market-public");
const outbox_public_1 = require("../outbox/outbox-public");
const growth_ports_public_1 = require("../growth/growth-ports-public");
const privacy_hash_1 = require("../common/privacy-hash");
const prisma_service_1 = require("../prisma/prisma.service");
const consent_service_1 = require("./consent/consent.service");
exports.CONSENT_PURPOSES = consent_service_1.CORE_CONSENT_PURPOSES;
exports.CONSENT_VERSION = 'TODO_NEEDS_HUMAN_v0';
const AGE_OF_MAJORITY = 18;
let PatientService = class PatientService {
    prisma;
    sessions;
    outbox;
    markets;
    consentSvc;
    growthFacts;
    exporters = new Map();
    anonymizers = new Map();
    constructor(prisma, sessions, outbox, markets, consentSvc, growthFacts) {
        this.prisma = prisma;
        this.sessions = sessions;
        this.outbox = outbox;
        this.markets = markets;
        this.consentSvc = consentSvc;
        this.growthFacts = growthFacts;
    }
    onModuleInit() {
        this.outbox.register('subject.deleted', async (e) => {
            await this.performDeletion(e.payload.sub, { viaIdp: true });
        });
    }
    registerExport(name, fn) { this.exporters.set(name, fn); }
    registerAnonymizer(name, fn) { this.anonymizers.set(name, fn); }
    async ensureProfile(u) {
        const existing = await this.prisma.patientProfile.findUnique({ where: { sub: u.sub } });
        if (existing)
            return existing;
        const created = await this.prisma.patientProfile.create({ data: { sub: u.sub, phone: u.phone, nameEn: u.name, preferredLocale: u.locale === 'en' ? 'en' : 'ar' } });
        await this.growthFacts?.recordFact({ name: 'PatientRegistered', naturalKey: (0, privacy_hash_1.subRefOf)(u.sub), props: {} }).catch(() => undefined);
        return created;
    }
    present(p) {
        const nid = p.nationalIdEnc ? (0, crypto_1.decryptField)(p.nationalIdEnc) : null;
        return {
            id: p.id, sub: p.sub, phone: p.phone, email: p.email, nameEn: p.nameEn, nameAr: p.nameAr, dateOfBirth: p.dateOfBirth, gender: p.gender,
            hasNationalId: !!nid, nationalIdLast4: nid ? nid.slice(-4) : null, preferredLocale: p.preferredLocale, market: p.market, noShowCount: p.noShowCount, createdAt: p.createdAt,
        };
    }
    async getProfile(u) {
        return this.present(await this.ensureProfile(u));
    }
    async updateProfile(u, i) {
        await this.ensureProfile(u);
        if (i.nationalId && !/^\d{14}$/.test(i.nationalId.trim()))
            throw (0, errors_1.badRequest)('INVALID_NATIONAL_ID', 'National ID must be 14 digits');
        if (i.preferredLocale && !['ar', 'en'].includes(i.preferredLocale))
            throw (0, errors_1.badRequest)('INVALID_LOCALE', 'locale must be ar or en');
        if (i.market !== undefined) {
            await this.markets.assertLive(i.market.toUpperCase());
        }
        const data = {};
        if (i.market)
            data.market = i.market.toUpperCase();
        for (const k of ['nameEn', 'nameAr', 'gender', 'preferredLocale', 'email', 'phone'])
            if (i[k] !== undefined)
                data[k] = i[k];
        if (i.dateOfBirth !== undefined)
            data.dateOfBirth = i.dateOfBirth ? new Date(i.dateOfBirth) : null;
        if (i.nationalId !== undefined) {
            const v = i.nationalId?.trim();
            data.nationalIdEnc = v ? (0, crypto_1.encryptField)(v) : null;
            data.nationalIdHash = v ? (0, crypto_1.blindIndex)(v) : null;
        }
        return this.present(await this.prisma.patientProfile.update({ where: { sub: u.sub }, data }));
    }
    async bookingIdentity(sub, dependantId) {
        const p = await this.prisma.patientProfile.findUnique({ where: { sub } });
        if (!p || p.deletedAt)
            throw (0, errors_1.notFound)('PROFILE_NOT_FOUND', 'Complete your profile first');
        if (dependantId) {
            const d = await this.prisma.dependant.findFirst({ where: { id: dependantId, guardianSub: sub, deletedAt: null } });
            if (!d)
                throw (0, errors_1.forbidden)('NOT_GUARDIAN', 'Not a guardian of this dependant');
            return { phone: p.phone ?? '', firstNameEn: d.nameEn.split(' ')[0], lastNameEn: d.nameEn.split(' ').slice(1).join(' ') || d.nameEn, gender: d.gender ?? undefined, nationalId: undefined, email: p.email ?? undefined, forDependant: true, locale: p.preferredLocale };
        }
        const parts = (p.nameEn ?? '').trim().split(/\s+/);
        if (!p.phone || !parts[0])
            throw (0, errors_1.badRequest)('PROFILE_INCOMPLETE', 'Name and phone are required to book');
        return { phone: p.phone, firstNameEn: parts[0], lastNameEn: parts.slice(1).join(' ') || parts[0], gender: p.gender ?? undefined, nationalId: p.nationalIdEnc ? (0, crypto_1.decryptField)(p.nationalIdEnc) : undefined, email: p.email ?? undefined, forDependant: false, locale: p.preferredLocale };
    }
    async profileBySub(sub) {
        return this.prisma.patientProfile.findUnique({ where: { sub } });
    }
    async incrementNoShow(sub) {
        await this.prisma.patientProfile.updateMany({ where: { sub }, data: { noShowCount: { increment: 1 } } });
    }
    async addDependant(u, i) {
        await this.ensureProfile(u);
        const dob = new Date(i.dateOfBirth);
        if (Number.isNaN(dob.getTime()) || dob > new Date())
            throw (0, errors_1.badRequest)('INVALID_DOB', 'Invalid date of birth');
        const expiresAt = new Date(dob);
        expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + AGE_OF_MAJORITY);
        if (expiresAt <= new Date())
            throw (0, errors_1.badRequest)('DEPENDANT_ADULT', 'Dependants must be under 18; adults create their own account (KA06)');
        return this.prisma.dependant.create({ data: { guardianSub: u.sub, nameEn: i.nameEn, nameAr: i.nameAr, dateOfBirth: dob, gender: i.gender, relationship: i.relationship, evidence: i.evidence, expiresAt } });
    }
    async listDependants(sub) {
        const rows = await this.prisma.dependant.findMany({ where: { guardianSub: sub, deletedAt: null }, orderBy: { createdAt: 'asc' } });
        return rows.map((d) => ({ ...d, guardianAccessExpired: !!d.expiresAt && d.expiresAt <= new Date() }));
    }
    async updateDependant(sub, id, i) {
        const r = await this.prisma.dependant.updateMany({ where: { id, guardianSub: sub, deletedAt: null }, data: i });
        if (!r.count)
            throw (0, errors_1.notFound)('DEPENDANT_NOT_FOUND', 'Dependant not found');
        return this.prisma.dependant.findUnique({ where: { id } });
    }
    async removeDependant(sub, id) {
        const r = await this.prisma.dependant.updateMany({ where: { id, guardianSub: sub, deletedAt: null }, data: { deletedAt: new Date() } });
        if (!r.count)
            throw (0, errors_1.notFound)('DEPENDANT_NOT_FOUND', 'Dependant not found');
        return { ok: true };
    }
    async assertGuardian(sub, dependantId) {
        const d = await this.prisma.dependant.findFirst({ where: { id: dependantId, guardianSub: sub, deletedAt: null } });
        if (!d)
            throw (0, errors_1.forbidden)('NOT_GUARDIAN', 'Not a guardian of this dependant');
        if (d.expiresAt && d.expiresAt <= new Date())
            throw (0, errors_1.forbidden)('GUARDIAN_ACCESS_EXPIRED', 'Dependant reached age of majority');
        return d;
    }
    async consents(sub) {
        const rows = await this.prisma.consentRecord.findMany({ where: { sub }, orderBy: { createdAt: 'desc' } });
        return exports.CONSENT_PURPOSES.map((purpose) => {
            const last = rows.find((r) => r.purpose === purpose);
            return { purpose, granted: last?.granted ?? false, version: last?.version ?? null, updatedAt: last?.createdAt ?? null };
        });
    }
    async consentHistory(sub) {
        return this.prisma.consentRecord.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 200 });
    }
    async setConsent(sub, purpose, granted, source = 'app') {
        return this.consentSvc.setConsent(sub, purpose, granted, typeof source === 'string' ? { source } : source);
    }
    async hasConsent(sub, purpose) {
        return this.consentSvc.hasConsent(sub, purpose);
    }
    async linkKiorlyPatient(i) {
        const existing = await this.prisma.kiorlyPatientLink.findMany({ where: { sub: i.sub, clinicId: i.clinicId, dependantId: i.dependantId ?? null } });
        if (existing.some((l) => l.kiorlyPatientId === i.kiorlyPatientId))
            return existing.find((l) => l.kiorlyPatientId === i.kiorlyPatientId);
        const status = existing.length ? 'CONFLICT_REVIEW' : 'LINKED';
        return this.prisma.kiorlyPatientLink.create({ data: { sub: i.sub, dependantId: i.dependantId, clinicId: i.clinicId, kiorlyPatientId: i.kiorlyPatientId, evidence: i.evidence, status } });
    }
    async recordIdentityConflict(sub, clinicId, detail) {
        return this.prisma.kiorlyPatientLink.create({ data: { sub, clinicId, kiorlyPatientId: `conflict:${Date.now()}`, evidence: detail.slice(0, 40), status: 'CONFLICT_REVIEW' } });
    }
    links(sub) {
        return this.prisma.kiorlyPatientLink.findMany({ where: { sub }, orderBy: { createdAt: 'desc' } });
    }
    async buildExport(sub) {
        const p = await this.prisma.patientProfile.findUnique({ where: { sub } });
        const out = {
            generatedAt: new Date().toISOString(),
            profile: p ? { ...this.present(p), nationalId: p.nationalIdEnc ? (0, crypto_1.decryptField)(p.nationalIdEnc) : null } : null,
            dependants: await this.prisma.dependant.findMany({ where: { guardianSub: sub } }),
            consents: await this.consentHistory(sub),
            kiorlyLinks: await this.links(sub),
        };
        for (const [name, fn] of this.exporters)
            out[name] = await fn(sub);
        return out;
    }
    async requestExport(sub) {
        const result = await this.buildExport(sub);
        const r = await this.prisma.dataRequest.create({ data: { sub, kind: 'EXPORT', status: 'COMPLETED', result: result, completedAt: new Date() } });
        return { id: r.id, ...result };
    }
    async requestDeletion(sub, opts) {
        const exportData = opts.includeExport ? await this.buildExport(sub) : undefined;
        await this.performDeletion(sub, { viaIdp: false });
        return { ok: true, deleted: true, ...(exportData ? { export: exportData } : {}), note: 'Legally required booking/payment records are retained without personal identifiers' };
    }
    async performDeletion(sub, _o) {
        const req = await this.prisma.dataRequest.create({ data: { sub, kind: 'DELETION' } });
        for (const fn of this.anonymizers.values())
            await fn(sub);
        await this.prisma.$transaction([
            this.prisma.patientProfile.updateMany({ where: { sub }, data: { phone: null, email: null, nameEn: null, nameAr: null, dateOfBirth: null, gender: null, nationalIdEnc: null, nationalIdHash: null, deletedAt: new Date() } }),
            this.prisma.dependant.updateMany({ where: { guardianSub: sub }, data: { nameEn: 'deleted', nameAr: null, deletedAt: new Date() } }),
            this.prisma.kiorlyPatientLink.deleteMany({ where: { sub } }),
            this.prisma.dataRequest.update({ where: { id: req.id }, data: { status: 'COMPLETED', completedAt: new Date() } }),
        ]);
        await this.sessions.revokeAllForSub(sub);
    }
};
exports.PatientService = PatientService;
exports.PatientService = PatientService = __decorate([
    (0, common_1.Injectable)(),
    __param(5, (0, common_1.Optional)()),
    __param(5, (0, common_1.Inject)(growth_ports_public_1.GROWTH_FACTS)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, auth_public_1.AuthSessionService, outbox_public_1.OutboxService, market_public_1.MarketService, consent_service_1.ConsentService, Object])
], PatientService);
//# sourceMappingURL=patient.service.js.map