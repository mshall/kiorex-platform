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
exports.SlugService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_errors_1 = require("../growth-errors");
const growth_flags_1 = require("../growth-flags");
const slug_1 = require("./slug");
let SlugService = class SlugService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    assertType(t) { if (!slug_1.SLUG_ENTITY_TYPES.includes(t))
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown slug entity type'); }
    async ensure(i) {
        this.assertType(i.entityType);
        const market = i.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        const have = await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType: i.entityType, entityId: i.entityId } } });
        if (have)
            return have.slug;
        const base = (0, slug_1.candidateSlug)(i.name, i.entityType, i.entityId);
        for (let n = 1; n < 200; n++) {
            const slug = n === 1 ? base : (0, slug_1.withSuffix)(base, n);
            if (await this.taken(market, i.entityType, slug, i.entityId))
                continue;
            try {
                return (await this.prisma.growthSlug.create({ data: { market, entityType: i.entityType, entityId: i.entityId, slug } })).slug;
            }
            catch (e) {
                if (e.code !== 'P2002')
                    throw e;
                const raced = await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType: i.entityType, entityId: i.entityId } } });
                if (raced)
                    return raced.slug;
            }
        }
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Could not find a free slug');
    }
    async taken(market, type, slug, exceptEntityId) {
        const [cur, hist] = await Promise.all([
            this.prisma.growthSlug.findUnique({ where: { market_entityType_slug: { market, entityType: type, slug } } }),
            this.prisma.growthSlugHistory.findUnique({ where: { market_entityType_slug: { market, entityType: type, slug } } }),
        ]);
        return (!!cur && cur.entityId !== exceptEntityId) || (!!hist && hist.entityId !== exceptEntityId);
    }
    async rename(i) {
        this.assertType(i.entityType);
        const market = i.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        if (!slug_1.SLUG_PATTERN.test(i.newSlug))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'A slug is 3 to 60 characters of a-z, 0-9 and hyphens');
        const cur = await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType: i.entityType, entityId: i.entityId } } });
        if (!cur)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'The entity has no slug yet: call ensure first');
        if (cur.slug === i.newSlug)
            return cur.slug;
        if (await this.taken(market, i.entityType, i.newSlug, i.entityId))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'That slug is already used by another entity (current or historic)');
        await this.prisma.$transaction(async (tx) => {
            await tx.growthSlugHistory.deleteMany({ where: { market, entityType: i.entityType, entityId: i.entityId, slug: i.newSlug } });
            await tx.growthSlugHistory.upsert({ where: { market_entityType_slug: { market, entityType: i.entityType, slug: cur.slug } }, create: { market, entityType: i.entityType, entityId: i.entityId, slug: cur.slug, replacedBy: i.newSlug }, update: { replacedBy: i.newSlug } });
            await tx.growthSlugHistory.updateMany({ where: { market, entityType: i.entityType, entityId: i.entityId }, data: { replacedBy: i.newSlug } });
            await tx.growthSlug.update({ where: { id: cur.id }, data: { slug: i.newSlug } });
        });
        return i.newSlug;
    }
    async resolve(entityType, slug, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        this.assertType(entityType);
        const cur = await this.prisma.growthSlug.findUnique({ where: { market_entityType_slug: { market, entityType, slug } } });
        if (cur)
            return { kind: 'CURRENT', entityId: cur.entityId, slug: cur.slug };
        const h = await this.prisma.growthSlugHistory.findUnique({ where: { market_entityType_slug: { market, entityType, slug } } });
        if (!h)
            return null;
        const now = await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType, entityId: h.entityId } } });
        return now ? { kind: 'REDIRECT', entityId: h.entityId, slug, to: now.slug, status: 301 } : null;
    }
    async release(entityType, entityId, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        this.assertType(entityType);
        await this.prisma.$transaction([
            this.prisma.growthSlugHistory.deleteMany({ where: { market, entityType, entityId } }),
            this.prisma.growthSlug.deleteMany({ where: { market, entityType, entityId } }),
        ]);
    }
};
exports.SlugService = SlugService;
exports.SlugService = SlugService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SlugService);
//# sourceMappingURL=slug.service.js.map