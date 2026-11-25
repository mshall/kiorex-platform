"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blendedCacWithRewards = exports.registrationToFirstBooking = exports.installToRegistration = exports.cpm = exports.cpc = exports.ctrPct = exports.SPEND_FLOOR_MINOR = exports.disputeRate = exports.bookingToAttended = exports.searchToBooking = exports.providerLedShare = exports.ltvToCac = exports.mer = exports.roas = exports.paidCac = exports.blendedCac = exports.REVENUE_STATUSES = exports.ltvMinor = exports.feeRevenue = exports.anpFeeBearing = exports.anpTotal = exports.pct = exports.ratio = void 0;
exports.kiorexRevenue = kiorexRevenue;
exports.campaignVerdict = campaignVerdict;
exports.guardRatio = guardRatio;
exports.reconcileSpend = reconcileSpend;
const ratio = (num, den) => (den > 0 ? num / den : null);
exports.ratio = ratio;
const pct = (num, den) => { const r = (0, exports.ratio)(num, den); return r === null ? null : Math.round(r * 10000) / 100; };
exports.pct = pct;
const anpTotal = (i) => Math.round(i.tenants * i.listedShare * i.listedPerTenant * i.anpPerListed);
exports.anpTotal = anpTotal;
const anpFeeBearing = (anp, providerLedShare) => Math.round(anp * (1 - providerLedShare));
exports.anpFeeBearing = anpFeeBearing;
const feeRevenue = (feeBearingAnp, feeMinor, disputeRate) => Math.round(feeBearingAnp * feeMinor * (1 - disputeRate));
exports.feeRevenue = feeRevenue;
const ltvMinor = (feeMinor, disputeRate, payMarginMinor = 0) => Math.round(feeMinor * (1 - disputeRate) + payMarginMinor);
exports.ltvMinor = ltvMinor;
exports.REVENUE_STATUSES = ['CONFIRMED', 'BILLED'];
function kiorexRevenue(facts) {
    const charged = facts.filter((f) => f.kind === 'CHARGE' && exports.REVENUE_STATUSES.includes(f.status)).reduce((s, f) => s + f.amountMinor, 0);
    const reversed = facts.filter((f) => f.kind === 'REVERSAL').reduce((s, f) => s + f.amountMinor, 0);
    const pending = facts.filter((f) => f.kind === 'CHARGE' && f.status === 'PENDING').reduce((s, f) => s + f.amountMinor, 0);
    return { revenueMinor: charged - reversed, chargedMinor: charged, reversedMinor: reversed, pendingMinor: pending };
}
const blendedCac = (spendMinor, anp) => (spendMinor > 0 ? (0, exports.ratio)(spendMinor, anp) : null);
exports.blendedCac = blendedCac;
const paidCac = (campaignSpendMinor, anpAttributedToCampaign) => (campaignSpendMinor > 0 ? (0, exports.ratio)(campaignSpendMinor, anpAttributedToCampaign) : null);
exports.paidCac = paidCac;
const roas = (attributedRevenueMinor, spendMinor) => (0, exports.ratio)(attributedRevenueMinor, spendMinor);
exports.roas = roas;
const mer = (revenueMinor, totalMarketingMinor) => (0, exports.ratio)(revenueMinor, totalMarketingMinor);
exports.mer = mer;
const ltvToCac = (ltv, cac) => (cac && cac > 0 ? ltv / cac : null);
exports.ltvToCac = ltvToCac;
const providerLedShare = (b) => (0, exports.ratio)(b.providerLed, b.providerLed + b.marketplace + b.unattributed);
exports.providerLedShare = providerLedShare;
const searchToBooking = (confirmed, searches) => (0, exports.ratio)(confirmed, searches);
exports.searchToBooking = searchToBooking;
const bookingToAttended = (attended, confirmed) => (0, exports.ratio)(attended, confirmed);
exports.bookingToAttended = bookingToAttended;
const disputeRate = (disputed, charges) => (0, exports.ratio)(disputed, charges);
exports.disputeRate = disputeRate;
function campaignVerdict(ltvOverCac) {
    if (ltvOverCac === null)
        return 'NO_DATA';
    return ltvOverCac >= 3 ? 'SCALE' : ltvOverCac >= 1 ? 'SUSTAIN' : 'REVIEW';
}
exports.SPEND_FLOOR_MINOR = 50_000;
const ctrPct = (clicks, impressions) => (0, exports.pct)(clicks, impressions);
exports.ctrPct = ctrPct;
const cpc = (spendMinor, clicks) => (spendMinor > 0 && clicks > 0 ? Math.round(spendMinor / clicks) : null);
exports.cpc = cpc;
const cpm = (spendMinor, impressions) => (spendMinor > 0 && impressions > 0 ? Math.round((spendMinor * 1000) / impressions) : null);
exports.cpm = cpm;
const installToRegistration = (registrations, installs) => (0, exports.pct)(registrations, installs);
exports.installToRegistration = installToRegistration;
const registrationToFirstBooking = (firstBookings, registrations) => (0, exports.pct)(firstBookings, registrations);
exports.registrationToFirstBooking = registrationToFirstBooking;
const blendedCacWithRewards = (spendMinor, rewardCostMinor, anp) => (anp > 0 && spendMinor + rewardCostMinor > 0 ? (0, exports.ratio)(spendMinor + rewardCostMinor, anp) : null);
exports.blendedCacWithRewards = blendedCacWithRewards;
function guardRatio(value, g) {
    if (g.people > 0 && g.people < 10)
        return { value: null, hidden: 'K_ANONYMITY' };
    if (g.spendMinor < (g.floor ?? exports.SPEND_FLOOR_MINOR))
        return { value: null, hidden: 'SPEND_FLOOR' };
    if (value === null || g.people === 0)
        return { value: null, hidden: 'NO_DENOMINATOR' };
    return { value, hidden: null };
}
function reconcileSpend(externalMinor, approvedMinor, toleranceBp = 500) {
    if (externalMinor === null || externalMinor <= 0)
        return { usedMinor: approvedMinor, source: approvedMinor > 0 ? 'APPROVED' : 'NONE', deltaBp: null, conflict: false, note: externalMinor === null ? 'NOT_CONNECTED' : 'NO_EXTERNAL_SPEND' };
    if (approvedMinor <= 0)
        return { usedMinor: externalMinor, source: 'ADAPTER', deltaBp: null, conflict: false, note: 'ADAPTER_ONLY' };
    const deltaBp = Math.round(((externalMinor - approvedMinor) * 10_000) / approvedMinor);
    const conflict = Math.abs(deltaBp) > toleranceBp;
    return { usedMinor: conflict ? externalMinor : approvedMinor, source: conflict ? 'ADAPTER' : 'APPROVED', deltaBp, conflict, note: conflict ? 'ADAPTER_WINS' : 'WITHIN_TOLERANCE' };
}
//# sourceMappingURL=formulas.js.map