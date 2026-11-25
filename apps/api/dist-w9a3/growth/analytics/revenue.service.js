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
exports.GrowthRevenueService = void 0;
const common_1 = require("@nestjs/common");
const ids_1 = require("../../common/ids");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const minor = (v) => {
    if (typeof v === 'number' && Number.isFinite(v))
        return Math.round(v * 100);
    if (typeof v === 'string' && /^-?\d+(\.\d{1,2})?$/.test(v))
        return Math.round(Number(v) * 100);
    return null;
};
let GrowthRevenueService = class GrowthRevenueService {
    prisma;
    log = new common_1.Logger('growth-revenue');
    constructor(prisma) {
        this.prisma = prisma;
    }
    async recordFromEvent(type, data, occurredAt) {
        try {
            const chargeId = typeof data.chargeId === 'string' ? data.chargeId : '';
            const appointmentId = typeof data.appointmentId === 'string' ? data.appointmentId : '';
            const amount = minor(data.amount);
            if (!chargeId || !appointmentId || amount === null || (type !== 'COMMISSION_CHARGE_CREATED' && type !== 'COMMISSION_CHARGE_REVERSED'))
                return false;
            const reversal = type === 'COMMISSION_CHARGE_REVERSED';
            const booking = await this.prisma.bookingIntent.findFirst({ where: { kiorlyAppointmentId: appointmentId }, select: { id: true } });
            const status = reversal ? 'REVERSED' : String(data.status ?? 'PENDING');
            const at = occurredAt && !Number.isNaN(Date.parse(occurredAt)) ? new Date(occurredAt) : new Date();
            const r = await this.prisma.growthRevenueFact.createMany({
                data: [{ market: growth_flags_1.GROWTH_DEFAULT_MARKET, kind: reversal ? 'REVERSAL' : 'CHARGE', chargeId, appointmentId, bookingId: booking?.id ?? null, status, amountMinor: Math.abs(amount), currency: String(data.currency ?? 'EGP').slice(0, 3), origin: typeof data.origin === 'string' ? data.origin : '', occurredAt: at }],
                skipDuplicates: true,
            });
            return r.count === 1;
        }
        catch (e) {
            this.log.warn(`revenue fact not recorded: ${e.message}`);
            return false;
        }
    }
    async onBookingCompleted(bookingId, at = new Date()) {
        try {
            const pending = await this.prisma.growthRevenueFact.findMany({ where: { bookingId, kind: 'CHARGE', status: 'PENDING' } });
            let n = 0;
            for (const p of pending) {
                if (await this.prisma.growthRevenueFact.findFirst({ where: { chargeId: p.chargeId, OR: [{ kind: 'REVERSAL' }, { kind: 'CHARGE', status: { in: ['CONFIRMED', 'BILLED', 'WAIVED'] } }] } }))
                    continue;
                const r = await this.prisma.growthRevenueFact.createMany({ data: [{ id: (0, ids_1.newId)('grf'), market: p.market, kind: 'CHARGE', chargeId: p.chargeId, appointmentId: p.appointmentId, bookingId, status: 'CONFIRMED', amountMinor: p.amountMinor, currency: p.currency, origin: p.origin, occurredAt: at }], skipDuplicates: true });
                n += r.count;
            }
            return n;
        }
        catch (e) {
            this.log.warn(`revenue confirmation for ${bookingId} failed: ${e.message}`);
            return 0;
        }
    }
};
exports.GrowthRevenueService = GrowthRevenueService;
exports.GrowthRevenueService = GrowthRevenueService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GrowthRevenueService);
//# sourceMappingURL=revenue.service.js.map