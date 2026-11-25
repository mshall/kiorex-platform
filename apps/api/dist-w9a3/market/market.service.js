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
exports.MarketService = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../common/errors");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const prisma_service_1 = require("../prisma/prisma.service");
const market_profile_service_1 = require("./market-profile.service");
const KEY = (cc) => `market.${cc.toLowerCase()}.live`;
let MarketService = class MarketService {
    prisma;
    flags;
    profiles;
    constructor(prisma, flags, profiles) {
        this.prisma = prisma;
        this.flags = flags;
        this.profiles = profiles;
    }
    async known() {
        await this.profiles.ensureFresh();
        const rows = await this.prisma.flagDefinition.findMany({ where: { key: { startsWith: 'market.', endsWith: '.live' } }, select: { key: true } });
        return rows.map((r) => r.key.split('.')[1].toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).sort();
    }
    async isLive(cc) {
        if (!(await this.known()).includes(cc.toUpperCase()))
            return false;
        return this.flags.isEnabled(KEY(cc), { market: cc.toUpperCase() });
    }
    async liveMarkets() {
        const out = [];
        for (const cc of await this.known())
            if (await this.flags.isEnabled(KEY(cc), { market: cc }))
                out.push(cc);
        return out;
    }
    async list() {
        const out = [];
        for (const cc of await this.known()) {
            const r = await this.flags.evaluate(KEY(cc), { market: cc });
            out.push({ code: cc, live: r.effective, flag: KEY(cc), state: r.effective ? 'LIVE' : r.reason });
        }
        return out;
    }
    async assertLive(cc) {
        if (!(await this.known()).includes(cc.toUpperCase()))
            throw new errors_1.ApiError(404, 'MARKET_UNKNOWN', 'Unknown market');
        const r = await this.flags.evaluate(KEY(cc), { market: cc.toUpperCase() });
        if (!r.effective)
            throw (0, errors_1.forbidden)('FEATURE_DISABLED', 'This market is not live yet', { key: KEY(cc), scope: r.scope ?? 'GATE', reason: r.reason });
    }
};
exports.MarketService = MarketService;
exports.MarketService = MarketService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, market_profile_service_1.MarketProfileService])
], MarketService);
//# sourceMappingURL=market.service.js.map