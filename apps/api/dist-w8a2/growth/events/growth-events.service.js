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
exports.GrowthEventsService = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_errors_1 = require("../growth-errors");
const growth_flags_1 = require("../growth-flags");
const growth_limiter_1 = require("../growth-limiter");
const growth_secrets_1 = require("../growth-secrets");
const growth_phi_guard_1 = require("./growth-phi-guard");
let GrowthEventsService = class GrowthEventsService {
    prisma;
    flags;
    limiter;
    constructor(prisma, flags, limiter) {
        this.prisma = prisma;
        this.flags = flags;
        this.limiter = limiter;
    }
    async ingest(events, ctx) {
        const market = ctx.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        const now = ctx.now ?? new Date();
        await this.limiter.take('events', ctx.ipHash, (0, growth_limiter_1.growthLimits)().eventsPerMin);
        const keyed = ctx.consentAnalytics && !!ctx.visitorKey && (await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.ANALYTICS_VISITOR, { market }).catch(() => false));
        const rows = events.map((e) => {
            const at = e.occurredAt ?? now;
            const identity = keyed ? `v:${ctx.visitorKey}` : `a:${ctx.ipHash}`;
            const dedupeKey = (0, growth_secrets_1.sha256Hex)(`c|${identity}|${e.name}|${e.landingKind ?? ''}|${e.careType ?? ''}|${(0, contracts_1.growthCanonicalJson)(e.props)}|${Math.floor(at.getTime() / 60_000)}`);
            return { market, name: e.name, visitorKey: keyed ? ctx.visitorKey : null, careType: e.careType ?? null, props: { ...(e.landingKind ? { landingKind: e.landingKind } : {}), ...e.props }, dedupeKey, occurredAt: at };
        });
        const r = await this.prisma.growthEvent.createMany({ data: rows, skipDuplicates: true });
        return { accepted: rows.length, duplicates: rows.length - r.count };
    }
    async recordFact(f) {
        if (!contracts_1.GROWTH_EVENT_NAMES.includes(f.name))
            throw (0, growth_errors_1.growthError)('GROWTH_EVENT_NOT_ALLOWED', `${f.name.slice(0, 40)} is not a canonical growth event`);
        const props = (0, growth_phi_guard_1.guardEventProps)(f.props ?? {});
        const r = await this.prisma.growthEvent.createMany({
            data: [{ market: f.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET, name: f.name, bookingId: f.bookingId ?? null, careType: f.careType ?? null, visitorKey: f.visitorKey ?? null, props: props, dedupeKey: `fact|${f.name}|${f.naturalKey}`, occurredAt: f.occurredAt ?? new Date() }],
            skipDuplicates: true,
        });
        return r.count === 1;
    }
};
exports.GrowthEventsService = GrowthEventsService;
exports.GrowthEventsService = GrowthEventsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, growth_limiter_1.GrowthLimiter])
], GrowthEventsService);
//# sourceMappingURL=growth-events.service.js.map