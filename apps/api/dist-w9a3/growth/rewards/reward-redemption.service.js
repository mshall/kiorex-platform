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
exports.RewardRedemptionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const checkout_lines_1 = require("./checkout-lines");
const reward_coupon_1 = require("./reward-coupon");
const reward_events_service_1 = require("./reward-events.service");
const reward_issuance_service_1 = require("./reward-issuance.service");
const reward_ledger_service_1 = require("./reward-ledger.service");
const reward_math_1 = require("./reward-math");
const reward_policy_service_1 = require("./reward-policy.service");
let RewardRedemptionService = class RewardRedemptionService {
    prisma;
    ledger;
    policy;
    issuance;
    events;
    log = new common_1.Logger('reward-redemption');
    constructor(prisma, ledger, policy, issuance, events) {
        this.prisma = prisma;
        this.ledger = ledger;
        this.policy = policy;
        this.issuance = issuance;
        this.events = events;
    }
    async snapshot() {
        const { rules, versionId } = await this.policy.rewardRules();
        const [rewardsOn, creditOn, familyAvailable] = await Promise.all([this.policy.rewardsOn(), this.policy.creditOn(), this.policy.familyAvailable(rules)]);
        return { rewardsOn, creditOn, familyAvailable, rules, versionId };
    }
    async plan(c, db = this.prisma, pre) {
        const now = c.now ?? new Date();
        const none = (extra = {}) => ({ applicableMinor: 0, picks: [], availableMinor: 0, ...extra });
        const { rewardsOn, creditOn, familyAvailable, rules } = pre ?? (await this.snapshot());
        if (!rewardsOn)
            return none();
        if (c.dependantId) {
            const member = familyAvailable ? await db.rewardHouseholdMember.findFirst({ where: { memberSub: `dep:${c.dependantId}`, endedAt: null, household: { ownerSub: c.sub } } }) : null;
            const dep = member ? await db.dependant.findFirst({ where: { id: c.dependantId, guardianSub: c.sub, deletedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true } }) : null;
            if (!member || !dep)
                return none({ couponProblem: c.couponCode || c.lotId ? 'NOT_APPLICABLE' : undefined, notApplicable: ['DEPENDANT_NOT_ENABLED'] });
        }
        let open = await this.ledger.openLots(db, { owners: [c.sub], now });
        const code = c.couponCode ? (0, reward_coupon_1.normalizeCoupon)(c.couponCode) : null;
        let couponProblem;
        let abuseCode;
        const explicit = new Set();
        if (c.couponCode) {
            if (!code)
                couponProblem = 'COUPON_INVALID';
            else {
                const lot = open.find((l) => l.couponCodeHash === (0, reward_coupon_1.couponHash)(code));
                if (lot)
                    explicit.add(lot.id);
                else {
                    couponProblem = 'COUPON_INVALID';
                    const other = await db.rewardLot.findFirst({ where: { couponCodeHash: (0, reward_coupon_1.couponHash)(code) }, select: { id: true, sub: true } });
                    if (other && other.sub !== c.sub)
                        abuseCode = code;
                }
            }
        }
        if (c.lotId) {
            if (open.some((l) => l.id === c.lotId && l.mode === 'COUPON'))
                explicit.add(c.lotId);
            else
                couponProblem = couponProblem ?? 'COUPON_INVALID';
        }
        open = open.filter((l) => (l.mode === 'CREDIT' ? creditOn : explicit.has(l.id)));
        const inScope = open.filter((l) => this.scopeOk(l, c));
        const notApplicable = open.filter((l) => !this.scopeOk(l, c)).map((l) => l.id);
        const available = inScope.reduce((s, l) => s + l.availableMinor, 0);
        const room = (0, reward_math_1.maxRedeemable)({ availableMinor: available, amountMinor: c.amountMinor, redemptionMaxBp: rules.redemptionMaxBp, minPayableMinor: rules.minPayableMinor });
        const picks = room > 0 ? (0, reward_math_1.consumeFifo)(inScope.map((l) => ({ id: l.id, remainingMinor: l.availableMinor, expiresAt: l.expiresAt, scoped: this.isScoped(l) })), room, now) : [];
        const by = new Map(inScope.map((l) => [l.id, l]));
        return {
            applicableMinor: (picks ?? []).reduce((s, p) => s + p.minor, 0), availableMinor: available, couponProblem, ...(abuseCode ? { abuseCode } : {}),
            picks: (picks ?? []).map((p) => ({ lotId: p.lotId, minor: p.minor, kind: by.get(p.lotId).kind, mode: by.get(p.lotId).mode, funding: by.get(p.lotId).funding })),
            ...(notApplicable.length ? { notApplicable } : {}),
        };
    }
    isScoped(l) { const s = l.scope; return (s.serviceKinds?.length ?? 0) > 0 || (s.specialtyAllowlist?.length ?? 0) > 0; }
    scopeOk(l, c) {
        const s = l.scope;
        if (s.serviceKinds?.length && !s.serviceKinds.includes(c.serviceKind))
            return false;
        if (s.specialtyAllowlist?.length && !(c.specialty && s.specialtyAllowlist.map((x) => x.toLowerCase()).includes(c.specialty.toLowerCase())))
            return false;
        return true;
    }
    async recordRedeemAbuse(code) {
        await this.prisma.growthFraudSignal.create({ data: { ruleId: 'RF_REDEEM_ABUSE', subjectHash: (0, reward_coupon_1.couponHash)(code).slice(0, 32), score: 90, evidenceRef: 'coupon-other-account' } }).catch(() => undefined);
    }
    async quoteLines(c) {
        const plan = await this.plan(c);
        if (plan.abuseCode)
            await this.recordRedeemAbuse(plan.abuseCode);
        const lines = (0, checkout_lines_1.composeCheckout)({ priceMinor: c.amountMinor, creditMinor: plan.applicableMinor });
        return { lines: lines.lines, payableMinor: lines.cardMinor, applicableMinor: lines.creditMinor, couponProblem: plan.couponProblem, notApplicable: plan.notApplicable ?? [] };
    }
    async reserveForDeposit(i) {
        const spons = i.sponsoredMinor ?? 0;
        const empty = { appliedMinor: 0, lines: (0, checkout_lines_1.composeCheckout)({ priceMinor: Math.max(i.amountMinor, 1) + spons, sponsoredMinor: spons }).lines, lots: [] };
        if (i.amountMinor < 1 || !(await this.policy.rewardsOn()))
            return empty;
        const pre = await this.snapshot();
        if (!pre.rewardsOn)
            return empty;
        let abuse;
        const out = await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`reward-reserve:${i.bookingId}`}))`;
            const open = await this.ledger.openReservations(tx, i.bookingId);
            if (open.length) {
                const total = open.reduce((s, r) => s + r.minor, 0);
                return { appliedMinor: total, lines: (0, checkout_lines_1.composeCheckout)({ priceMinor: i.amountMinor + spons, sponsoredMinor: spons, creditMinor: total }).lines, lots: open.map((r) => ({ lotId: r.lotId, minor: r.minor })) };
            }
            const plan0 = await this.plan({ ...i, now: new Date() }, tx, pre);
            abuse = plan0.abuseCode;
            if (!plan0.picks.length)
                return { ...empty, lines: (0, checkout_lines_1.composeCheckout)({ priceMinor: i.amountMinor + spons, sponsoredMinor: spons }).lines, ...(plan0.couponProblem ? { couponProblem: plan0.couponProblem } : {}) };
            await this.ledger.lock(tx, plan0.picks.map((p) => p.lotId));
            const plan = await this.plan({ ...i, now: new Date() }, tx, pre);
            const versionId = pre.versionId;
            let total = 0;
            const lots = [];
            for (const p of plan.picks) {
                const cycle = await tx.rewardLedgerEntry.count({ where: { lotId: p.lotId, bookingId: i.bookingId, type: 'UNRESERVE' } });
                await this.ledger.append(tx, { lotId: p.lotId, type: 'RESERVE', amountMinor: p.minor, idempotencyKey: (0, reward_math_1.entryKey)('reserve', i.bookingId, p.lotId, cycle), ruleVersionId: versionId, reasonCode: 'CHECKOUT', actor: `patient:${i.sub.slice(0, 8)}`, bookingId: i.bookingId, currency: i.currency });
                await this.ledger.refreshStatus(tx, p.lotId);
                total += p.minor;
                lots.push({ lotId: p.lotId, minor: p.minor });
            }
            const composed = (0, checkout_lines_1.composeCheckout)({ priceMinor: i.amountMinor + spons, sponsoredMinor: spons, creditMinor: total });
            await tx.rewardCheckoutLine.create({ data: { sub: i.sub, bookingId: i.bookingId, priceMinor: i.amountMinor + spons, lines: composed.lines } });
            return { appliedMinor: total, lines: composed.lines, lots };
        }, { timeout: 30_000, maxWait: 30_000 });
        if (abuse)
            await this.recordRedeemAbuse(abuse);
        return out;
    }
    async releaseForBooking(bookingId, reason, outer) {
        if (!outer && !(await this.ledger.openReservations(this.prisma, bookingId)).length)
            return 0;
        const { versionId } = await this.policy.rewardRules();
        const run = (fn) => (outer ? fn(outer) : this.prisma.$transaction(fn, { timeout: 30_000, maxWait: 30_000 }));
        return run(async (tx) => {
            const open = await this.ledger.openReservations(tx, bookingId);
            if (!open.length)
                return 0;
            await this.ledger.lock(tx, open.map((o) => o.lotId));
            let n = 0;
            for (const r of open) {
                const cycle = await tx.rewardLedgerEntry.count({ where: { lotId: r.lotId, bookingId, type: 'UNRESERVE' } });
                await this.ledger.append(tx, { lotId: r.lotId, type: 'UNRESERVE', amountMinor: r.minor, idempotencyKey: (0, reward_math_1.entryKey)('unreserve', bookingId, r.lotId, cycle), ruleVersionId: versionId, reasonCode: reason.slice(0, 60).replace(/[^A-Z0-9_]/gi, '_').toUpperCase() || 'RELEASED', actor: 'system:pay', bookingId });
                await this.ledger.refreshStatus(tx, r.lotId);
                n += r.minor;
            }
            return n;
        });
    }
    async redeemOnCapture(tx, i) {
        const open = await this.ledger.openReservations(tx, i.bookingId);
        const out = { totalMinor: 0, patientRefundMinor: 0, promoMinor: 0, postedMinor: 0 };
        if (!open.length)
            return out;
        await this.ledger.lock(tx, open.map((o) => o.lotId));
        const { rules, versionId } = await this.policy.rewardRules();
        const post = rules.postToPayLedger;
        for (const r of open) {
            const lot = await tx.rewardLot.findUniqueOrThrow({ where: { id: r.lotId } });
            await this.ledger.append(tx, { lotId: r.lotId, type: 'REDEEM', amountMinor: r.minor, idempotencyKey: (0, reward_math_1.entryKey)('redeem', i.paymentId, r.lotId), ruleVersionId: versionId, reasonCode: 'DEPOSIT_PAID', actor: 'system:pay', bookingId: i.bookingId });
            if (lot.mode === 'COUPON' && lot.kind !== 'RESTORED') {
                const bal = await this.ledger.balance(tx, r.lotId);
                if (bal.available > 0)
                    await this.ledger.append(tx, { lotId: r.lotId, type: 'EXPIRE', amountMinor: bal.available, idempotencyKey: (0, reward_math_1.entryKey)('expire', 'single-use', r.lotId), ruleVersionId: versionId, reasonCode: 'COUPON_SINGLE_USE', actor: 'system:pay', bookingId: i.bookingId });
            }
            await this.ledger.refreshStatus(tx, r.lotId);
            out.totalMinor += r.minor;
            if (lot.funding === 'PATIENT_REFUND')
                out.patientRefundMinor += r.minor;
            else
                out.promoMinor += r.minor;
            await this.events.emit(tx, 'RewardRedeemed', 'RewardLot', r.lotId, { lotRef: r.lotId, market: lot.market, mode: lot.mode, amountMinor: r.minor, currency: lot.currency, reasonCode: 'DEPOSIT_PAID', idempotencyKey: (0, reward_math_1.entryKey)('redeem', i.paymentId, r.lotId), at: new Date().toISOString() }, `${i.paymentId}:${r.lotId}`);
        }
        out.postedMinor = out.patientRefundMinor + (post ? out.promoMinor : 0);
        return out;
    }
    async restoreForRefund(tx, i) {
        const none = { restoredMinor: 0, patientRefundRestoredMinor: 0, promoRestoredMinor: 0, postedRestoredMinor: 0, lotIds: [] };
        if (i.paymentRewardMinor <= 0 || i.paymentCardMinor <= 0)
            return none;
        const redeemed = await this.ledger.redeemedFor(tx, i.bookingId);
        if (!redeemed.length)
            return none;
        const priorRestored = await tx.rewardLot.findMany({ where: { kind: 'RESTORED', reasonCode: { startsWith: `RESTORED:${i.paymentId}` } }, select: { id: true, amountMinor: true, funding: true } });
        const done = priorRestored.reduce((s, l) => s + l.amountMinor, 0);
        const cumulativeRefund = i.alreadyRefundedMinor + i.cardRefundMinor;
        const target = cumulativeRefund >= i.paymentCardMinor ? i.paymentRewardMinor : Math.round((cumulativeRefund / i.paymentCardMinor) * i.paymentRewardMinor);
        const now = Math.min(Math.max(0, target - done), i.paymentRewardMinor - done);
        if (now <= 0)
            return none;
        const { rules, versionId } = await this.policy.rewardRules();
        const pre = { rules, versionId, rewardsOn: true, mode: 'CREDIT' };
        const totalPaid = redeemed.reduce((s, r) => s + r.minor, 0);
        const shares = redeemed.map((r) => ({ r, exact: (now * r.minor) / totalPaid })).map((x) => ({ ...x, floor: Math.floor(x.exact) }));
        let left = now - shares.reduce((s, x) => s + x.floor, 0);
        shares.sort((a, b) => (b.exact - b.floor) - (a.exact - a.floor) || (a.r.lotId < b.r.lotId ? -1 : 1));
        for (const x of shares)
            if (left > 0) {
                x.floor += 1;
                left -= 1;
            }
        const out = { ...none, lotIds: [] };
        for (const x of shares.sort((a, b) => (a.r.lotId < b.r.lotId ? -1 : 1))) {
            if (x.floor <= 0)
                continue;
            const orig = await tx.rewardLot.findUniqueOrThrow({ where: { id: x.r.lotId } });
            const minExpiry = new Date(Date.now() + rules.credit.refundAsCredit.restoredLotMinDays * 86_400_000);
            const issued = await this.issuance.issue({
                kind: 'RESTORED', sub: orig.sub, amountMinor: x.floor, funding: orig.funding, mode: orig.mode, idempotencyKey: (0, reward_issuance_service_1.issueKey)('restored', i.refundId, x.r.lotId), reasonCode: `RESTORED:${i.paymentId}`, actor: 'system:pay',
                scope: (orig.scope ?? {}), campaignId: orig.campaignId, refundId: i.refundId, bookingId: i.bookingId, expiresAt: orig.expiresAt > minExpiry ? orig.expiresAt : minExpiry, pre,
            }, tx);
            if (issued.status === 'SKIPPED') {
                this.log.error(`restore of ${x.floor} for refund ${i.refundId} skipped: ${issued.reason}`);
                continue;
            }
            out.restoredMinor += x.floor;
            out.lotIds.push(issued.lotId);
            if (orig.funding === 'PATIENT_REFUND')
                out.patientRefundRestoredMinor += x.floor;
            else
                out.promoRestoredMinor += x.floor;
            await this.events.emit(tx, 'RewardRestored', 'RewardLot', issued.lotId, { lotRef: x.r.lotId, restoredLotRef: issued.lotId, market: orig.market, amountMinor: x.floor, currency: orig.currency, reasonCode: 'BOOKING_CANCELLED', at: new Date().toISOString() }, `${i.refundId}:${x.r.lotId}`);
        }
        const patientTotal = redeemed.filter((r) => r.funding === 'PATIENT_REFUND').reduce((s, r) => s + r.minor, 0);
        const promoTotal = totalPaid - patientTotal;
        const promoPostedTotal = Math.max(0, i.paymentRewardPostedMinor - patientTotal);
        out.postedRestoredMinor = cumulativeRefund >= i.paymentCardMinor ? i.paymentRewardPostedMinor
            : Math.min(i.paymentRewardPostedMinor, out.patientRefundRestoredMinor + (promoTotal > 0 && promoPostedTotal > 0 ? Math.round((out.promoRestoredMinor / promoTotal) * promoPostedTotal) : 0));
        return out;
    }
};
exports.RewardRedemptionService = RewardRedemptionService;
exports.RewardRedemptionService = RewardRedemptionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, reward_ledger_service_1.RewardLedgerService, reward_policy_service_1.RewardPolicyService, reward_issuance_service_1.RewardIssuanceService, reward_events_service_1.RewardEventsService])
], RewardRedemptionService);
//# sourceMappingURL=reward-redemption.service.js.map