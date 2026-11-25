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
exports.CorporateBenefitService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const errors_1 = require("../../common/errors");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const corporate_code_1 = require("./corporate-code");
const corporate_math_1 = require("./corporate-math");
const LIVE_BOOKING = ['INTENT', 'HELD', 'PENDING_CLINIC', 'CONFIRMED', 'CHECKED_IN'];
const MAX_RETRIES = 3;
const useOf = (r) => {
    const n = (v) => Number(v ?? 0n);
    const [a, b, c, d] = [n(r?.reserved), n(r?.released), n(r?.redeemed), n(r?.reversed)];
    return { reserved: a, released: b, redeemed: c, reversed: d, used: a - b - d, held: a - b - c, net: c - d };
};
let CorporateBenefitService = class CorporateBenefitService {
    prisma;
    flags;
    log = new common_1.Logger('corporate-benefit');
    constructor(prisma, flags) {
        this.prisma = prisma;
        this.flags = flags;
    }
    on(market) { return this.flags.isEnabled(growth_flags_1.CORPORATE_FLAG, { market }).catch(() => false); }
    async use(db, where) {
        const cond = [where.accountId ? client_1.Prisma.sql `"accountId" = ${where.accountId}` : null, where.memberId ? client_1.Prisma.sql `"memberId" = ${where.memberId}` : null, where.bookingId ? client_1.Prisma.sql `"bookingId" = ${where.bookingId}` : null].filter(Boolean);
        if (!cond.length)
            throw new RangeError('use() needs a filter');
        const rows = await db.$queryRaw(client_1.Prisma.sql `
      SELECT sum(CASE "type" WHEN 'RESERVE' THEN "amountMinor" END) AS reserved, sum(CASE "type" WHEN 'RELEASE' THEN "amountMinor" END) AS released,
             sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" END) AS redeemed, sum(CASE "type" WHEN 'REVERSE' THEN "amountMinor" END) AS reversed
        FROM "CorporateBenefitEntry" WHERE ${client_1.Prisma.join(cond, ' AND ')}`);
        return useOf(rows[0]);
    }
    async activeMembership(sub, now = new Date(), db = this.prisma) {
        const m = await db.corporateMember.findFirst({ where: { subHash: (0, corporate_code_1.memberHashOf)(sub), endedAt: null }, include: { account: true } });
        if (!m)
            return null;
        const a = m.account;
        if (a.status !== 'ACTIVE' || (a.startsAt && a.startsAt > now) || (a.endsAt && a.endsAt <= now))
            return null;
        return m;
    }
    async size(sub, bookingId, now) {
        const b = await this.prisma.bookingIntent.findFirst({ where: { id: bookingId, sub }, select: { id: true, status: true, depositAmountMinor: true, currency: true, dependantId: true, tenantId: true } });
        if (!b)
            throw (0, errors_1.notFound)('BOOKING_NOT_FOUND', 'Booking not found');
        const m = await this.activeMembership(sub, now);
        if (!m || b.dependantId || !LIVE_BOOKING.includes(b.status) || b.depositAmountMinor <= 0 || b.currency !== m.account.currency)
            return null;
        if (!(await this.on(m.account.market)))
            return null;
        const a = m.account;
        if (a.sponsorCeilingMinor == null || a.coverBp == null)
            return null;
        const [accUse, memUse] = await Promise.all([this.use(this.prisma, { accountId: a.id }), this.use(this.prisma, { memberId: m.id })]);
        const cap = m.perMemberCapMinor ?? a.perMemberCapMinor ?? 0;
        const amount = (0, corporate_math_1.benefitFor)({ depositMinor: b.depositAmountMinor, coverBp: a.coverBp, perVisitMaxMinor: a.perVisitMaxMinor, memberRemainingMinor: Math.max(0, cap - memUse.used), accountRemainingMinor: Math.max(0, a.sponsorCeilingMinor - accUse.used) });
        return { booking: b, member: m, account: a, amount };
    }
    async quote(sub, bookingId, now = new Date()) {
        const s = await this.size(sub, bookingId, now);
        if (!s || s.amount <= 0)
            return null;
        const held = await this.use(this.prisma, { bookingId });
        if (held.used > 0)
            return { accountRef: s.account.id, amountMinor: held.used, currency: s.account.currency, sponsor: { ar: s.account.displayName, en: s.account.displayName }, endsAt: s.account.endsAt?.toISOString() ?? null };
        return { accountRef: s.account.id, amountMinor: s.amount, currency: s.account.currency, sponsor: { ar: s.account.displayName, en: s.account.displayName }, endsAt: s.account.endsAt?.toISOString() ?? null };
    }
    async reserve(sub, bookingId, now = new Date()) {
        try {
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                const existing = await this.use(this.prisma, { bookingId });
                const first = await this.prisma.corporateBenefitEntry.findFirst({ where: { bookingId, type: 'RESERVE' }, orderBy: { createdAt: 'desc' } });
                if (existing.used > 0 && first)
                    return { amountMinor: existing.used, currency: first.currency, reservationRef: first.id };
                const s = await this.size(sub, bookingId, now);
                if (!s || s.amount <= 0)
                    return null;
                const nth = await this.prisma.corporateBenefitEntry.count({ where: { bookingId, type: 'RESERVE' } });
                try {
                    const e = await this.prisma.corporateBenefitEntry.create({ data: { accountId: s.account.id, memberId: s.member.id, type: 'RESERVE', amountMinor: s.amount, currency: s.account.currency, bookingId, idempotencyKey: `corp:rsv:${bookingId}:${nth}`, reasonCode: 'BOOKING_DEPOSIT', actor: 'system:booking' } });
                    return { amountMinor: e.amountMinor, currency: e.currency, reservationRef: e.id };
                }
                catch (e) {
                    const msg = e.message;
                    if (/CORPORATE_CEILING_EXCEEDED|CORPORATE_MEMBER_CAP_EXCEEDED/.test(msg))
                        continue;
                    if (/Unique constraint|CORPORATE_ALREADY_RESERVED/.test(msg))
                        continue;
                    throw e;
                }
            }
            return null;
        }
        catch (e) {
            this.log.warn(`corporate reserve failed for ${bookingId}: ${e.message}`);
            return null;
        }
    }
    async move(bookingId, type, reason, cap) {
        const u = await this.use(this.prisma, { bookingId });
        const room = type === 'REVERSE' ? u.net : u.held;
        const amount = Math.min(room, cap ?? room);
        if (amount <= 0)
            return 0;
        const last = await this.prisma.corporateBenefitEntry.findFirst({ where: { bookingId, type: 'RESERVE' }, orderBy: { createdAt: 'desc' } });
        if (!last)
            return 0;
        const nth = await this.prisma.corporateBenefitEntry.count({ where: { bookingId, type } });
        try {
            await this.prisma.corporateBenefitEntry.create({ data: { accountId: last.accountId, memberId: last.memberId, type, amountMinor: amount, currency: last.currency, bookingId, idempotencyKey: `corp:${type.toLowerCase()}:${bookingId}:${nth}`, reasonCode: reason, actor: 'system:pay' } });
            return amount;
        }
        catch (e) {
            if (/Unique constraint|CORPORATE_NOTHING_/.test(e.message))
                return 0;
            throw e;
        }
    }
    redeem(bookingId, reason = 'DEPOSIT_CAPTURED') { return this.move(bookingId, 'REDEEM', reason); }
    release(bookingId, reason = 'BOOKING_NOT_PAID') { return this.move(bookingId, 'RELEASE', reason); }
    reverse(bookingId, amountMinor, reason = 'DEPOSIT_REFUNDED') { return this.move(bookingId, 'REVERSE', reason, amountMinor); }
    async releaseStale(now = new Date()) {
        const cutoff = new Date(now.getTime() - 15 * 60_000);
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT e."bookingId" FROM "CorporateBenefitEntry" e WHERE e."type" = 'RESERVE' AND e."createdAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM "PaymentIntent" p WHERE p."bookingId" = e."bookingId" AND p."status" IN ('CAPTURED','PARTIALLY_REFUNDED','REFUNDED'))
        AND (EXISTS (SELECT 1 FROM "BookingIntent" b WHERE b."id" = e."bookingId" AND b."status" IN ('CANCELLED','EXPIRED','NO_SHOW','COMPLETED'))
          OR e."createdAt" < ${new Date(now.getTime() - 24 * 3600_000)})
      GROUP BY e."bookingId" LIMIT 500`);
        let n = 0;
        for (const r of rows)
            n += await this.release(r.bookingId, 'STALE_RESERVATION') > 0 ? 1 : 0;
        return n;
    }
    async reconcile(accountId) {
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT "accountId", "bookingId", sum(CASE "type" WHEN 'RESERVE' THEN "amountMinor" ELSE 0 END) AS reserved, sum(CASE "type" WHEN 'RELEASE' THEN "amountMinor" ELSE 0 END) AS released,
             sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" ELSE 0 END) AS redeemed, sum(CASE "type" WHEN 'REVERSE' THEN "amountMinor" ELSE 0 END) AS reversed
        FROM "CorporateBenefitEntry" ${accountId ? client_1.Prisma.sql `WHERE "accountId" = ${accountId}` : client_1.Prisma.empty} GROUP BY "accountId", "bookingId"`);
        const out = [];
        for (const r of rows) {
            const u = useOf(r);
            if (u.held < 0 || u.net < 0 || u.used < 0)
                out.push(`booking ${r.bookingId}: held ${u.held} redeemed ${u.net} used ${u.used}`);
        }
        const accounts = await this.prisma.corporateAccount.findMany({ where: accountId ? { id: accountId } : {}, select: { id: true, sponsorCeilingMinor: true } });
        for (const a of accounts) {
            const u = await this.use(this.prisma, { accountId: a.id });
            if (a.sponsorCeilingMinor != null && u.used > a.sponsorCeilingMinor)
                out.push(`account ${a.id}: used ${u.used} above ceiling ${a.sponsorCeilingMinor}`);
        }
        return out;
    }
};
exports.CorporateBenefitService = CorporateBenefitService;
exports.CorporateBenefitService = CorporateBenefitService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService])
], CorporateBenefitService);
//# sourceMappingURL=corporate-benefit.service.js.map