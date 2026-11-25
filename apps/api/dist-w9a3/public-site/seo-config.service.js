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
exports.SeoConfigService = void 0;
exports.mergeSeoConfig = mergeSeoConfig;
const market_core_public_1 = require("../market/market-core-public");
const common_1 = require("@nestjs/common");
const growth_public_1 = require("../growth/growth-public");
const growth_readers_public_1 = require("../growth/growth-readers-public");
const seo_public_1 = require("../growth/seo/seo-public");
const prisma_service_1 = require("../prisma/prisma.service");
const DEFAULTS = () => ({ ...growth_public_1.GROWTH_DEFAULT_PAYLOADS.SEO, ...(0, seo_public_1.SEO_EXTENSION_DEFAULTS)() });
function mergeSeoConfig(base, payload) {
    if (!payload || typeof payload !== 'object')
        return base;
    const out = { ...base, ...(0, seo_public_1.mergeSeoExtensions)(base, payload) };
    for (const [k, v] of Object.entries(payload)) {
        if (k in base && !(k in (0, seo_public_1.SEO_EXTENSION_DEFAULTS)()) && typeof v === typeof base[k] && (!Array.isArray(v) || Array.isArray(base[k])))
            out[k] = v;
    }
    return out;
}
let SeoConfigService = class SeoConfigService {
    prisma;
    cache = new Map();
    readers;
    constructor(prisma) {
        this.prisma = prisma;
        this.readers = new growth_readers_public_1.ConfigReaders(prisma);
    }
    invalidate() { this.cache.clear(); }
    async get(market = market_core_public_1.DEFAULT_MARKET) {
        const hit = this.cache.get(market);
        if (hit && Date.now() - hit.at < 30_000) {
            await this.report(hit.used);
            return hit.cfg;
        }
        const now = new Date();
        let cfg = DEFAULTS();
        const used = [];
        try {
            const rows = await this.prisma.growthConfigVersion.findMany({
                where: { kind: 'SEO', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: market }] },
                orderBy: { version: 'asc' },
            });
            const live = rows.filter((r) => (!r.effectiveFrom || r.effectiveFrom <= now) && (!r.effectiveTo || r.effectiveTo > now));
            for (const scope of ['GLOBAL', 'MARKET']) {
                const mine = live.filter((x) => x.scope === scope);
                for (const r of mine)
                    cfg = mergeSeoConfig(cfg, r.payload);
                const last = mine[mine.length - 1];
                if (last)
                    used.push({ scope, scopeId: last.scopeId, versionId: last.id, version: last.version });
            }
        }
        catch { }
        this.cache.set(market, { at: Date.now(), cfg, used });
        await this.report(used);
        return cfg;
    }
    async report(used) {
        for (const u of used)
            await this.readers.record('seo-renderer', { kind: 'SEO', ...u });
    }
};
exports.SeoConfigService = SeoConfigService;
exports.SeoConfigService = SeoConfigService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SeoConfigService);
//# sourceMappingURL=seo-config.service.js.map