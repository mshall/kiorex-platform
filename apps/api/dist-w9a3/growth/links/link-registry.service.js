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
var LinkRegistryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinkRegistryService = exports.linkProductOf = void 0;
const common_1 = require("@nestjs/common");
const kiorly_public_1 = require("../../kiorly/kiorly-public");
const partner_http_1 = require("../../common/partner-http");
const partners_public_1 = require("../../partners/partners-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const STATUSES = new Set(['ACTIVE', 'PAUSED', 'REVOKED']);
const FRESH_MS = 5 * 60_000;
const PRODUCTS = new Set(['CLINIC', 'PHARMACY', 'LAB', 'NURSE']);
const linkProductOf = (v) => (typeof v === 'string' && PRODUCTS.has(v) ? v : 'CLINIC');
exports.linkProductOf = linkProductOf;
const PARTNER_KIND = { PHARMACY: 'PHARMACY', LAB: 'LAB' };
let LinkRegistryService = LinkRegistryService_1 = class LinkRegistryService {
    prisma;
    kiorly;
    partners;
    log = new common_1.Logger('link-registry');
    constructor(prisma, kiorly, partners) {
        this.prisma = prisma;
        this.kiorly = kiorly;
        this.partners = partners;
    }
    where(code, market) { return { market_sourceKind_sourceRef: { market, sourceKind: 'PROVIDER_LINK', sourceRef: code } }; }
    async learn(code, orgRef, market = growth_flags_1.GROWTH_DEFAULT_MARKET, product) {
        const c = code.toUpperCase();
        if (!CODE.test(c) || !orgRef)
            return 'CONFLICT';
        const where = this.where(c, market);
        const found = await this.prisma.growthAcquisitionSource.findUnique({ where });
        if (found) {
            if (found.ownerOrgRef && found.ownerOrgRef !== orgRef)
                return 'CONFLICT';
            if (!found.ownerOrgRef)
                await this.prisma.growthAcquisitionSource.updateMany({ where: { id: found.id, ownerOrgRef: null }, data: { ownerOrgRef: orgRef, ...(product ? { product } : {}) } });
            else if (product && found.product !== product)
                await this.prisma.growthAcquisitionSource.updateMany({ where: { id: found.id, ownerOrgRef: orgRef }, data: { product } });
            if (found.linkStatus !== 'ACTIVE')
                return 'REVOKED';
            return found.ownerOrgRef === orgRef ? 'KNOWN' : 'REGISTERED';
        }
        try {
            await this.prisma.growthAcquisitionSource.create({ data: { market, sourceKind: 'PROVIDER_LINK', sourceRef: c, ownerOrgRef: orgRef, ...(product ? { product } : {}) } });
            return 'REGISTERED';
        }
        catch (e) {
            if (e.code !== 'P2002')
                throw e;
            const again = await this.prisma.growthAcquisitionSource.findUnique({ where });
            if (again?.ownerOrgRef !== orgRef)
                return 'CONFLICT';
            return again.linkStatus === 'ACTIVE' ? 'KNOWN' : 'REVOKED';
        }
    }
    async orgOf(code, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const src = await this.prisma.growthAcquisitionSource.findUnique({ where: this.where(code.toUpperCase(), market) });
        return src?.ownerOrgRef ?? null;
    }
    async statusOf(code, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const src = await this.prisma.growthAcquisitionSource.findUnique({ where: this.where(code.toUpperCase(), market) });
        return src ? src.linkStatus : null;
    }
    async apply(code, orgRef, status, at, market, checked, product) {
        const c = code.toUpperCase();
        if (!CODE.test(c) || !orgRef || !STATUSES.has(status))
            return 'CONFLICT';
        const where = this.where(c, market);
        const data = { ...(product ? { product } : {}), linkStatus: status, linkRevokedAt: status === 'REVOKED' ? at : null, ...(checked ? { registryCheckedAt: new Date() } : {}) };
        const found = await this.prisma.growthAcquisitionSource.findUnique({ where });
        if (found) {
            if (found.ownerOrgRef && found.ownerOrgRef !== orgRef)
                return 'CONFLICT';
            if (found.linkStatus === 'REVOKED' && status !== 'REVOKED')
                return 'REVOKED';
            await this.prisma.growthAcquisitionSource.update({ where: { id: found.id }, data: { ...data, ...(found.ownerOrgRef ? {} : { ownerOrgRef: orgRef }) } });
            return status === 'ACTIVE' ? (found.ownerOrgRef === orgRef ? 'KNOWN' : 'REGISTERED') : 'REVOKED';
        }
        try {
            await this.prisma.growthAcquisitionSource.create({ data: { market, sourceKind: 'PROVIDER_LINK', sourceRef: c, ownerOrgRef: orgRef, ...data } });
            return status === 'ACTIVE' ? 'REGISTERED' : 'REVOKED';
        }
        catch (e) {
            if (e.code !== 'P2002')
                throw e;
            return this.apply(code, orgRef, status, at, market, checked, product);
        }
    }
    static orgFrom(data) {
        return typeof data.orgRef === 'string' ? data.orgRef : typeof data.tenantId === 'string' ? data.tenantId : '';
    }
    async registerFromEvent(data, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const code = typeof data.linkCode === 'string' ? data.linkCode : '';
        const org = LinkRegistryService_1.orgFrom(data);
        if (!code || !org)
            return 'IGNORED';
        return this.learn(code, org, market, data.product === undefined ? undefined : (0, exports.linkProductOf)(data.product));
    }
    async revokeFromEvent(data, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const code = typeof data.linkCode === 'string' ? data.linkCode : '';
        const org = LinkRegistryService_1.orgFrom(data);
        if (!code || !org)
            return 'IGNORED';
        const at = typeof data.revokedAt === 'string' && !Number.isNaN(Date.parse(data.revokedAt)) ? new Date(data.revokedAt) : new Date();
        return this.apply(code, org, 'REVOKED', at, market, false, data.product === undefined ? undefined : (0, exports.linkProductOf)(data.product));
    }
    async confirm(code, orgRef, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const c = code.toUpperCase();
        const stored = await this.prisma.growthAcquisitionSource.findUnique({ where: this.where(c, market) });
        if (stored?.linkStatus === 'REVOKED')
            return stored.ownerOrgRef && stored.ownerOrgRef !== orgRef ? 'CONFLICT' : 'REVOKED';
        if (stored?.registryCheckedAt && Date.now() - stored.registryCheckedAt.getTime() < FRESH_MS)
            return this.learn(c, orgRef, market);
        if (this.kiorly) {
            try {
                const r = await this.kiorly.referralLink(c);
                const rec = r.data;
                if (rec && rec.code?.toUpperCase() === c && rec.orgRef === orgRef)
                    return this.apply(c, rec.orgRef, rec.status, rec.revokedAt ? new Date(rec.revokedAt) : new Date(), market, true);
                if (rec && rec.code?.toUpperCase() === c && rec.orgRef !== orgRef)
                    return 'CONFLICT';
            }
            catch (e) {
                if (!(e instanceof kiorly_public_1.KiorlyHttpError && e.status === 404))
                    this.log.debug(`link lookup failed (${e.message}); keeping the stored state`);
            }
        }
        return this.learn(c, orgRef, market);
    }
    async confirmPartner(code, orgRef, product, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const c = code.toUpperCase();
        const stored = await this.prisma.growthAcquisitionSource.findUnique({ where: this.where(c, market) });
        if (stored?.linkStatus === 'REVOKED')
            return stored.ownerOrgRef && stored.ownerOrgRef !== orgRef ? 'CONFLICT' : 'REVOKED';
        if (stored?.registryCheckedAt && Date.now() - stored.registryCheckedAt.getTime() < FRESH_MS)
            return this.learn(c, orgRef, market, product);
        if (this.partners && PARTNER_KIND[product]) {
            for (const reg of await this.partners.activeRegistrations(PARTNER_KIND[product])) {
                try {
                    const r = await (0, partner_http_1.partnerRequest)(await this.partners.conn(PARTNER_KIND[product], reg.id), { method: 'GET', path: `/referral-links/${encodeURIComponent(c)}` });
                    const rec = r.data;
                    if (rec?.code?.toUpperCase() !== c)
                        continue;
                    if (rec.orgRef !== orgRef)
                        return 'CONFLICT';
                    return this.apply(c, rec.orgRef, rec.status, rec.revokedAt ? new Date(rec.revokedAt) : new Date(), market, true, product);
                }
                catch (e) {
                    this.log.debug(`partner link lookup failed (${e.message}); keeping the stored state`);
                }
            }
        }
        return this.learn(c, orgRef, market, product);
    }
    async reconcile(since, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const out = { scanned: 0, applied: 0, conflicts: 0 };
        if (!this.kiorly)
            return out;
        let cursor;
        for (let page = 0; page < 200; page += 1) {
            const r = await this.kiorly.referralLinks({ ...(since ? { updatedSince: since.toISOString() } : {}), limit: 200, ...(cursor ? { cursor } : {}) });
            for (const rec of r.data.items ?? []) {
                out.scanned += 1;
                const res = await this.apply(rec.code, rec.orgRef, rec.status, rec.revokedAt ? new Date(rec.revokedAt) : new Date(), market, true);
                if (res === 'CONFLICT')
                    out.conflicts += 1;
                else
                    out.applied += 1;
            }
            cursor = r.data.nextCursor ?? undefined;
            if (!cursor)
                break;
        }
        return out;
    }
};
exports.LinkRegistryService = LinkRegistryService;
exports.LinkRegistryService = LinkRegistryService = LinkRegistryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Optional)()),
    __param(2, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, kiorly_public_1.KiorlyClient, partners_public_1.PartnerRegistry])
], LinkRegistryService);
//# sourceMappingURL=link-registry.service.js.map