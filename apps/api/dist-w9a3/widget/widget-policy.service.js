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
exports.WidgetPolicyService = exports.WIDGET_POLICY_DEFAULT = void 0;
const market_core_public_1 = require("../market/market-core-public");
const common_1 = require("@nestjs/common");
const growth_readers_public_1 = require("../growth/growth-readers-public");
const prisma_service_1 = require("../prisma/prisma.service");
exports.WIDGET_POLICY_DEFAULT = {
    maxOriginsPerOrg: 10, allowLocalhostOrigins: false, sessionTokenTtlSeconds: 900, maxActiveHoldsPerPhone: 3, maxActiveHoldsPerIpHash: 5, embedHost: 'https://book.kiorex.com', sdkCacheSeconds: 31536000,
};
let WidgetPolicyService = class WidgetPolicyService {
    prisma;
    cache;
    readers;
    constructor(prisma) {
        this.prisma = prisma;
        this.readers = new growth_readers_public_1.ConfigReaders(prisma);
    }
    async report(u) { if (u)
        await this.readers.record('widget-host', { kind: 'WIDGET_POLICY', ...u }); }
    async get() {
        if (this.cache && Date.now() - this.cache.at < 30_000) {
            await this.report(this.cache.used);
            return this.cache.value;
        }
        const now = new Date();
        let value = exports.WIDGET_POLICY_DEFAULT;
        let used;
        for (const [scope, scopeId] of [['MARKET', market_core_public_1.DEFAULT_MARKET], ['GLOBAL', '']]) {
            const row = await this.prisma.growthConfigVersion.findFirst({
                where: { kind: 'WIDGET_POLICY', scope, scopeId, status: 'ACTIVE', effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
                orderBy: { effectiveFrom: 'desc' },
            });
            if (row) {
                value = { ...exports.WIDGET_POLICY_DEFAULT, ...row.payload };
                used = { scope, scopeId, versionId: row.id, version: row.version };
                break;
            }
        }
        this.cache = { at: now.getTime(), value, used };
        await this.report(used);
        return value;
    }
    invalidate() { this.cache = undefined; }
};
exports.WidgetPolicyService = WidgetPolicyService;
exports.WidgetPolicyService = WidgetPolicyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], WidgetPolicyService);
//# sourceMappingURL=widget-policy.service.js.map