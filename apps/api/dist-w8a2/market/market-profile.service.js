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
exports.MarketProfileService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const market_profile_1 = require("./market-profile");
const market_registry_1 = require("./market-registry");
let MarketProfileService = class MarketProfileService {
    prisma;
    log = new common_1.Logger('MarketProfile');
    timer;
    loadedAt = 0;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async onModuleInit() {
        await this.refresh().catch((e) => this.log.warn(`first load failed: ${e.message}`));
        const ms = Number(process.env.MARKET_PROFILE_REFRESH_MS ?? 15_000);
        if (process.env.NODE_ENV !== 'test' && Number.isFinite(ms) && ms > 0) {
            this.timer = setInterval(() => void this.refresh().catch(() => undefined), ms);
            this.timer.unref();
        }
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async refresh(now = new Date()) {
        const rows = await this.prisma.growthConfigVersion.findMany({
            where: { kind: 'MARKET_PROFILE', scope: 'MARKET', status: { in: ['ACTIVE', 'APPROVED'] }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
            orderBy: [{ scopeId: 'asc' }, { effectiveFrom: 'desc' }, { version: 'desc' }],
        });
        const out = new Map();
        for (const r of rows) {
            if (out.has(r.scopeId))
                continue;
            const errs = (0, market_profile_1.validateMarketProfile)(r.payload);
            const p = r.payload;
            if (errs.length || p.cc !== r.scopeId) {
                this.log.warn(`MARKET_PROFILE ${r.scopeId} v${r.version} ignored: ${errs[0] ?? 'cc differs from the scope'}`);
                continue;
            }
            out.set(r.scopeId, (0, market_profile_1.normalizeMarketProfile)(r.payload));
        }
        const list = [...out.values()];
        (0, market_registry_1.setMarketProfileSnapshot)(list);
        this.loadedAt = Date.now();
        return list;
    }
    async ensureFresh(maxAgeMs = 5000) { if (Date.now() - this.loadedAt > maxAgeMs)
        await this.refresh().catch(() => undefined); }
    configured() { return (0, market_registry_1.marketProfileSnapshot)(); }
};
exports.MarketProfileService = MarketProfileService;
exports.MarketProfileService = MarketProfileService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], MarketProfileService);
//# sourceMappingURL=market-profile.service.js.map