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
exports.FraudConfigService = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const fraud_config_1 = require("./fraud-config");
let FraudConfigService = class FraudConfigService {
    prisma;
    cache = new Map();
    constructor(prisma) {
        this.prisma = prisma;
    }
    invalidate() { this.cache.clear(); }
    async get(market = market_core_public_1.DEFAULT_MARKET) {
        const hit = this.cache.get(market);
        const ttl = process.env.NODE_ENV === 'test' ? 0 : 15_000;
        if (hit && Date.now() - hit.at < ttl)
            return { ...hit.cfg, version: hit.version };
        const now = new Date();
        let cfg = (0, fraud_config_1.FRAUD_RULES_DEFAULTS)();
        let version = null;
        try {
            const rows = await this.prisma.growthConfigVersion.findMany({ where: { kind: 'FRAUD_RULES', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: market }] }, orderBy: { version: 'asc' } });
            const live = rows.filter((r) => (!r.effectiveFrom || r.effectiveFrom <= now) && (!r.effectiveTo || r.effectiveTo > now));
            for (const scope of ['GLOBAL', 'MARKET']) {
                const last = live.filter((r) => r.scope === scope).pop();
                if (last) {
                    cfg = (0, fraud_config_1.mergeFraudRules)(cfg, last.payload);
                    version = last.version;
                }
            }
        }
        catch { }
        this.cache.set(market, { at: Date.now(), cfg, version });
        return { ...cfg, version };
    }
};
exports.FraudConfigService = FraudConfigService;
exports.FraudConfigService = FraudConfigService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], FraudConfigService);
//# sourceMappingURL=fraud-config.service.js.map