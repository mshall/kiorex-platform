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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingGrowthService = exports.platformOf = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const attribution_service_1 = require("../attribution/attribution.service");
const revenue_service_1 = require("../analytics/revenue.service");
const growth_failures_1 = require("../growth-failures");
const growth_events_service_1 = require("../events/growth-events.service");
const growth_ports_public_1 = require("../growth-ports-public");
const PLATFORMS = new Set(['web', 'ios', 'android', 'whatsapp', 'widget']);
const platformOf = (v) => (typeof v === 'string' && PLATFORMS.has(v.toLowerCase()) ? v.toLowerCase() : undefined);
exports.platformOf = platformOf;
let BookingGrowthService = class BookingGrowthService {
    attribution;
    events;
    prisma;
    revenue;
    referral;
    log = new common_1.Logger('booking-growth');
    constructor(attribution, events, prisma, revenue, referral) {
        this.attribution = attribution;
        this.events = events;
        this.prisma = prisma;
        this.revenue = revenue;
        this.referral = referral;
    }
    async onIntent(b, market, ctx = {}) {
        if (b.dependantId)
            return;
        const props = ctx.platform ? { platform: (0, exports.platformOf)(ctx.platform) ?? 'web' } : {};
        await this.safe('SlotSelected', () => this.events.recordFact({ name: 'SlotSelected', naturalKey: b.id, bookingId: b.id, careType: b.careType, market, props, occurredAt: b.createdAt }));
        await this.safe('BookingInitiated', () => this.events.recordFact({ name: 'BookingInitiated', naturalKey: b.id, bookingId: b.id, careType: b.careType, market, props, occurredAt: b.createdAt }));
    }
    async decide(bookingId, ctx = {}) {
        try {
            return await this.attribution.decideForBooking({ bookingId, visitorKey: ctx.visitorKey ?? null, ltToken: ctx.lt ?? null });
        }
        catch (e) {
            (0, growth_failures_1.recordGrowthFailure)(growth_failures_1.GROWTH_FAILURE.ATTRIBUTION_DECISION);
            this.log.error(`${growth_failures_1.GROWTH_FAILURE.ATTRIBUTION_DECISION} booking=${bookingId} (booking continues UNATTRIBUTED): ${e.message}`, e.stack);
            return null;
        }
    }
    async forConfirm(bookingId, ctx = {}) {
        const d = await this.decide(bookingId, ctx);
        if (!d)
            return {};
        try {
            const acquisition = await this.attribution.acquisitionBlock(bookingId);
            if (!acquisition)
                return {};
            const latest = await this.attribution.latest(bookingId);
            const snap = latest?.bookingSnapshot;
            const lt = ctx.lt && snap?.booking?.ltValidForOrg === true && acquisition.origin === 'PROVIDER_LED' ? ctx.lt : undefined;
            return { acquisition, ...(lt ? { lt } : {}) };
        }
        catch (e) {
            this.log.warn(`acquisition block for ${bookingId} failed (sent without it): ${e.message}`);
            return {};
        }
    }
    async fact(name, b, market, props = {}, at) {
        if (b.dependantId)
            return;
        await this.safe(name, () => this.events.recordFact({ name, naturalKey: b.id, bookingId: b.id, careType: b.careType, market, props, ...(at ? { occurredAt: at } : {}) }));
        if (name === 'BookingCancelled')
            await this.safe('referral:cancelled', () => this.referral?.onBookingCancelled(b.id) ?? Promise.resolve());
    }
    async onCompleted(bookingId) {
        await this.revenue.onBookingCompleted(bookingId);
        await this.safe('referral:completed', () => this.referral?.onBookingCompleted(bookingId) ?? Promise.resolve());
    }
    async safe(what, fn) { try {
        await fn();
    }
    catch (e) {
        this.log.warn(`growth fact ${what} not recorded: ${e.message}`);
    } }
};
exports.BookingGrowthService = BookingGrowthService;
exports.BookingGrowthService = BookingGrowthService = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Optional)()),
    __param(4, (0, common_1.Inject)(growth_ports_public_1.REFERRAL_PORT)),
    __metadata("design:paramtypes", [attribution_service_1.AttributionService, growth_events_service_1.GrowthEventsService, prisma_service_1.PrismaService, revenue_service_1.GrowthRevenueService, Object])
], BookingGrowthService);
//# sourceMappingURL=booking-growth.service.js.map