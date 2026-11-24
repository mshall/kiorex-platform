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
exports.PartnerRegistry = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const config_1 = require("../common/config");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../prisma/prisma.service");
const PATH = { PHARMACY: contracts_1.PARTNER_API_PATH.pharmacy, LAB: contracts_1.PARTNER_API_PATH.lab, LAB_NURSE: contracts_1.PARTNER_API_PATH.lab };
const KIND = (k) => { const u = k.toUpperCase().replace('-', '_'); if (u !== 'PHARMACY' && u !== 'LAB' && u !== 'LAB_NURSE')
    throw (0, errors_1.badRequest)('INVALID_PARTNER_KIND', 'kind must be pharmacy, lab or lab_nurse'); return u; };
let PartnerRegistry = class PartnerRegistry {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    envConn(kind) {
        const c = (0, config_1.cfg)();
        if (kind === 'PHARMACY')
            return { baseUrl: c.pharmacyBaseUrl, clientKey: c.pharmacyClientKey, clientSecret: c.pharmacyClientSecret, webhookSecret: c.pharmacyWebhookSecret };
        if (kind === 'LAB_NURSE')
            return { baseUrl: c.labBaseUrl, clientKey: c.labNurseClientKey, clientSecret: c.labNurseClientSecret, webhookSecret: '' };
        return { baseUrl: c.labBaseUrl, clientKey: c.labClientKey, clientSecret: c.labClientSecret, webhookSecret: c.labWebhookSecret };
    }
    async conn(kind, registrationId) {
        let reg;
        if (registrationId) {
            reg = await this.prisma.partnerRegistration.findUnique({ where: { id: registrationId } });
            if (!reg || reg.kind !== kind)
                throw (0, errors_1.unavailable)('PARTNER_REGISTRATION_MISSING', 'The partner that owns this request is no longer registered', { retryable: false });
        }
        else
            reg = await this.prisma.partnerRegistration.findFirst({ where: { kind, active: true }, orderBy: { createdAt: 'asc' } });
        const c = reg ? { baseUrl: reg.baseUrl, clientKey: reg.clientKey, clientSecret: (0, crypto_1.decryptField)(reg.clientSecretEnc) } : this.envConn(kind);
        return { baseUrl: `${c.baseUrl.replace(/\/+$/, '')}${PATH[kind]}`, clientKey: c.clientKey, clientSecret: c.clientSecret, timeoutMs: (0, config_1.cfg)().partnerTimeoutMs };
    }
    async webhookSecret(kind, clientKey) { return (await this.webhookAuth(kind, clientKey))?.secret ?? null; }
    async webhookAuth(kind, clientKey) {
        if (clientKey) {
            const reg = await this.prisma.partnerRegistration.findFirst({ where: { kind, clientKey, active: true } });
            if (reg)
                return { secret: (0, crypto_1.decryptField)(reg.webhookSecretEnc), registrationId: reg.id };
            const e = this.envConn(kind);
            return !(0, config_1.cfg)().isProd && e.clientKey === clientKey && e.webhookSecret ? { secret: e.webhookSecret, registrationId: null } : null;
        }
        return (0, config_1.cfg)().isProd || !this.envConn(kind).webhookSecret ? null : { secret: this.envConn(kind).webhookSecret, registrationId: null };
    }
    async activeRegistrations(kind) { return this.prisma.partnerRegistration.findMany({ where: { kind, active: true }, orderBy: { createdAt: 'asc' }, select: { id: true, kind: true, name: true, clientKey: true, labRegistrationId: true } }); }
    async registration(id) { return id ? this.prisma.partnerRegistration.findUnique({ where: { id }, select: { id: true, kind: true, name: true, clientKey: true, active: true } }) : null; }
    async orgRefOf(registrationId) {
        if (!registrationId)
            return null;
        return (await this.prisma.partnerConnection.findFirst({ where: { registrationId }, select: { orgRef: true } }))?.orgRef ?? null;
    }
    present(r) {
        return { id: r.id, kind: r.kind.toLowerCase(), name: r.name, baseUrl: r.baseUrl, clientKey: r.clientKey, clientSecret: '********', webhookSecret: '********', active: r.active, apiPath: PATH[r.kind], labRegistrationId: r.labRegistrationId ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
    }
    async list() { return (await this.prisma.partnerRegistration.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] })).map((r) => this.present(r)); }
    async upsert(kindRaw, id, i) {
        const kind = KIND(kindRaw);
        if (i.baseUrl !== undefined && !/^https?:\/\/[^/\s]+$/.test(i.baseUrl.replace(/\/+$/, '')))
            throw (0, errors_1.badRequest)('INVALID_BASE_URL', 'baseUrl must be a host URL without a path, e.g. http://localhost:3100');
        if (id) {
            const cur = await this.prisma.partnerRegistration.findUnique({ where: { id } });
            if (!cur || cur.kind !== kind)
                throw (0, errors_1.notFound)('PARTNER_NOT_FOUND', 'Partner registration not found');
            return this.present(await this.prisma.partnerRegistration.update({ where: { id }, data: { name: i.name, baseUrl: i.baseUrl?.replace(/\/+$/, ''), clientKey: i.clientKey, ...(i.labRegistrationId !== undefined && kind === 'LAB_NURSE' ? { labRegistrationId: i.labRegistrationId || null } : {}), ...(i.clientSecret ? { clientSecretEnc: (0, crypto_1.encryptField)(i.clientSecret) } : {}), ...(i.webhookSecret ? { webhookSecretEnc: (0, crypto_1.encryptField)(i.webhookSecret) } : {}), active: i.active } }));
        }
        if (!i.name || !i.baseUrl || !i.clientKey || !i.clientSecret || (!i.webhookSecret && kind !== 'LAB_NURSE'))
            throw (0, errors_1.badRequest)('PARTNER_INCOMPLETE', 'name, baseUrl, clientKey, clientSecret and webhookSecret are required (LAB_NURSE: webhookSecret is not used)');
        const r = await this.prisma.partnerRegistration.create({ data: { id: `pr_${kind.toLowerCase()}_${Math.random().toString(36).slice(2, 10)}`, kind, name: i.name, baseUrl: i.baseUrl.replace(/\/+$/, ''), clientKey: i.clientKey, clientSecretEnc: (0, crypto_1.encryptField)(i.clientSecret), webhookSecretEnc: (0, crypto_1.encryptField)(i.webhookSecret ?? ''), active: i.active ?? true, ...(kind === 'LAB_NURSE' && i.labRegistrationId ? { labRegistrationId: i.labRegistrationId } : {}) } });
        return this.present(r);
    }
    async seedDev(kindRaw) {
        if ((0, config_1.cfg)().isProd)
            throw (0, errors_1.badRequest)('DEV_ONLY', 'dev partner registration is never created in production');
        const kind = KIND(kindRaw);
        const e = this.envConn(kind);
        const id = `pr_${kind.toLowerCase()}_dev`;
        const data = { kind, name: `Kiorly ${kind === 'PHARMACY' ? 'Pharmacy' : kind === 'LAB_NURSE' ? 'Lab (nurse source)' : 'Lab'} (dev)`, baseUrl: e.baseUrl.replace(/\/+$/, ''), clientKey: e.clientKey, clientSecretEnc: (0, crypto_1.encryptField)(e.clientSecret), webhookSecretEnc: (0, crypto_1.encryptField)(e.webhookSecret), active: true };
        const labRegistrationId = kind === 'LAB_NURSE' ? 'pr_lab_dev' : undefined;
        await this.prisma.partnerRegistration.upsert({ where: { id }, create: { id, ...data, ...(labRegistrationId ? { labRegistrationId } : {}) }, update: { ...data, ...(labRegistrationId ? { labRegistrationId } : {}) } });
    }
};
exports.PartnerRegistry = PartnerRegistry;
exports.PartnerRegistry = PartnerRegistry = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PartnerRegistry);
//# sourceMappingURL=partners.service.js.map