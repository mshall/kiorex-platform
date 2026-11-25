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
exports.CrossProductFunnelService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const kanon_1 = require("../analytics/kanon");
const growth_flags_1 = require("../growth-flags");
const continuity_rules_1 = require("./continuity-rules");
const continuity_service_1 = require("./continuity.service");
const DAY = 86_400_000;
const isMasked = (v) => typeof v === 'string';
let CrossProductFunnelService = class CrossProductFunnelService {
    prisma;
    cross;
    constructor(prisma, cross) {
        this.prisma = prisma;
        this.cross = cross;
    }
    async funnel(days = 30, market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const d = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
        const since = new Date(Date.now() - d * DAY);
        const [visits, offeredRows, dismissedRows, links] = await Promise.all([
            this.prisma.bookingIntent.count({ where: { status: 'COMPLETED', dependantId: null, startsAt: { gte: since, lte: new Date() } } }),
            this.prisma.crossProductEntryPoint.groupBy({ by: ['kind'], where: { market, createdAt: { gte: since } }, _count: { _all: true } }),
            this.prisma.crossProductEntryPoint.groupBy({ by: ['kind'], where: { market, createdAt: { gte: since }, dismissedAt: { not: null }, consumedAt: null }, _count: { _all: true } }),
            this.prisma.crossProductContinuity.findMany({ where: { market, createdAt: { gte: since } }, select: { entryPoint: true, parentOrigin: true, lagHours: true, toOrigin: true }, take: 50_000 }),
        ]);
        const n = (rows, k) => rows.find((r) => r.kind === k)?._count._all ?? 0;
        const continuedRaw = (k) => links.filter((l) => l.entryPoint === k).length;
        const offeredCells = (0, kanon_1.applyKAnonymity)(continuity_rules_1.CONTINUITY_ENTRY_KINDS.map((k) => ({ key: k, count: n(offeredRows, k) })), { totalShown: false });
        const continuedCells = (0, kanon_1.applyKAnonymity)(continuity_rules_1.CONTINUITY_ENTRY_KINDS.map((k) => ({ key: k, count: continuedRaw(k) })), { totalShown: false });
        const products = continuity_rules_1.CONTINUITY_ENTRY_KINDS.map((k, i) => {
            const mine = links.filter((l) => l.entryPoint === k);
            const origins = (0, kanon_1.applyKAnonymity)(['PROVIDER_LED', 'MARKETPLACE', 'UNATTRIBUTED'].map((o) => ({ key: o, count: mine.filter((l) => l.parentOrigin === o).length })));
            const lag = (0, kanon_1.applyKAnonymity)(continuity_rules_1.LAG_BUCKETS.map((b) => ({ key: b, count: mine.filter((l) => (0, continuity_rules_1.lagBucket)(l.lagHours) === b).length })));
            const offered = offeredCells[i].count;
            const continued = continuedCells[i].count;
            const dismissed = (0, kanon_1.maskCount)(n(dismissedRows, k));
            const raw = { offered: n(offeredRows, k), continued: mine.length, dismissed: n(dismissedRows, k) };
            const dropOff = isMasked(offered) || isMasked(continued) || isMasked(dismissed) ? '<10' : Math.max(0, raw.offered - raw.continued - raw.dismissed);
            return {
                product: continuity_rules_1.ENTRY_META[k].toProduct, entryPoint: k, offered, dismissed, continued, notContinued: dropOff,
                bySourceOfFirstBooking: Object.fromEntries(origins.map((c) => [c.key, c.count])),
                timeToContinue: Object.fromEntries(lag.map((c) => [c.key, c.count])),
            };
        });
        return {
            days: d, market, enabled: await this.cross.isOn(market),
            clinicVisitsCompleted: (0, kanon_1.maskCount)(visits),
            products,
            rewards: 'NONE', commissionLink: 'INERT',
        };
    }
};
exports.CrossProductFunnelService = CrossProductFunnelService;
exports.CrossProductFunnelService = CrossProductFunnelService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, continuity_service_1.CrossProductService])
], CrossProductFunnelService);
//# sourceMappingURL=continuity-funnel.service.js.map