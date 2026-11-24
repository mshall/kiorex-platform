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
exports.RedirectsService = exports.PrismaSlugStore = void 0;
exports.resolveSlug = resolveSlug;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const url_policy_1 = require("./url-policy");
async function resolveSlug(store, market, entityType, slug) {
    const cur = await store.current(market, entityType, slug);
    if (cur)
        return { kind: 'found', entityId: cur.entityId, slug: cur.slug };
    const old = await store.history(market, entityType, slug);
    if (!old)
        return { kind: 'unknown' };
    const now = (await store.currentFor(market, entityType, old.entityId)) ?? old.replacedBy;
    if (!now || now === slug)
        return { kind: 'unknown' };
    return { kind: 'moved', entityId: old.entityId, slug: now };
}
let PrismaSlugStore = class PrismaSlugStore {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async current(market, entityType, slug) {
        const r = await this.prisma.growthSlug.findUnique({ where: { market_entityType_slug: { market, entityType, slug } }, select: { entityId: true, slug: true } });
        return r ?? null;
    }
    async history(market, entityType, slug) {
        const r = await this.prisma.growthSlugHistory.findUnique({ where: { market_entityType_slug: { market, entityType, slug } }, select: { entityId: true, replacedBy: true } });
        return r ?? null;
    }
    async currentFor(market, entityType, entityId) {
        const r = await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType, entityId } }, select: { slug: true } });
        return r?.slug ?? null;
    }
    async currentForMany(market, entityType, entityIds) {
        if (!entityIds.length)
            return new Map();
        const rows = await this.prisma.growthSlug.findMany({ where: { market, entityType, entityId: { in: entityIds } }, select: { entityId: true, slug: true } });
        return new Map(rows.map((r) => [r.entityId, r.slug]));
    }
};
exports.PrismaSlugStore = PrismaSlugStore;
exports.PrismaSlugStore = PrismaSlugStore = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PrismaSlugStore);
let RedirectsService = class RedirectsService {
    store;
    prisma;
    constructor(store, prisma) {
        this.store = store;
        this.prisma = prisma;
    }
    resolve(market, entityType, slug) { return resolveSlug(this.store, market, entityType, slug); }
    slugFor(market, entityType, entityId) { return this.store.currentFor(market, entityType, entityId); }
    slugsFor(market, entityType, entityIds) { return this.store.currentForMany(market, entityType, entityIds); }
    async legacyDoctorTarget(id, locale) {
        if (!/^[A-Za-z0-9_-]{3,64}$/.test(id))
            return null;
        const p = await this.prisma.provider.findUnique({ where: { id }, select: { id: true, market: true, careType: true } });
        if (!p)
            return null;
        const slug = await this.store.currentFor(p.market, 'DOCTOR', p.id);
        if (!slug)
            return null;
        return (0, url_policy_1.buildPath)(locale, p.market, p.careType === 'HOME_NURSING' ? 'nurse' : 'doctor', { slug });
    }
};
exports.RedirectsService = RedirectsService;
exports.RedirectsService = RedirectsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [PrismaSlugStore, prisma_service_1.PrismaService])
], RedirectsService);
//# sourceMappingURL=redirects.service.js.map