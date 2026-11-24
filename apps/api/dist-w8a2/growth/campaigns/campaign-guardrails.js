"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyCapReached = exports.budgetExhausted = exports.thresholdsToFire = exports.utilisationBp = exports.budgetIncreaseNeedsApproval = exports.hasSensitiveChannel = void 0;
exports.validatePlan = validatePlan;
exports.approvalRequired = approvalRequired;
exports.validateSpendLine = validateSpendLine;
exports.plannedInMonth = plannedInMonth;
exports.monthsOf = monthsOf;
exports.ceilingBreach = ceilingBreach;
exports.validateAssetRef = validateAssetRef;
const contracts_1 = require("@kiorex/contracts");
const market_day_1 = require("./market-day");
const campaign_state_1 = require("./campaign.state");
function validatePlan(p, policy, marketCurrency) {
    const errors = [];
    const int = (v) => typeof v === 'number' && Number.isInteger(v);
    if (!int(p.budgetTotalMinor) || p.budgetTotalMinor <= 0)
        errors.push({ path: '/budgetTotalMinor', message: 'The total budget must be a positive whole number of minor units' });
    if (!int(p.budgetDailyMinor) || p.budgetDailyMinor <= 0)
        errors.push({ path: '/budgetDailyMinor', message: 'The daily cap must be a positive whole number of minor units' });
    if (int(p.budgetTotalMinor) && int(p.budgetDailyMinor) && p.budgetDailyMinor > p.budgetTotalMinor)
        errors.push({ path: '/budgetDailyMinor', message: 'The daily cap cannot exceed the total budget' });
    if (p.budgetTotalMinor > 2_000_000_000)
        errors.push({ path: '/budgetTotalMinor', message: 'The total budget is above the largest amount the system stores' });
    if (!marketCurrency)
        errors.push({ path: '/currency', message: 'The market has no currency configured' });
    else if (p.currency !== marketCurrency)
        errors.push({ path: '/currency', message: `The currency must be the market currency (${marketCurrency})` });
    if (!p.channels.length)
        errors.push({ path: '/channels', message: 'Choose at least one channel' });
    for (const ch of p.channels) {
        if (!contracts_1.CAMPAIGN_CHANNELS.includes(ch))
            errors.push({ path: '/channels', message: `${ch} is not a channel` });
        else if (!policy.allowedChannels.includes(ch))
            errors.push({ path: '/channels', message: `${ch} is not allowed by the campaign policy` });
    }
    if (new Set(p.channels).size !== p.channels.length)
        errors.push({ path: '/channels', message: 'A channel is listed twice' });
    if (p.startsAt && p.endsAt && p.endsAt.getTime() <= p.startsAt.getTime())
        errors.push({ path: '/endsAt', message: 'The end must be after the start' });
    return errors;
}
const hasSensitiveChannel = (channels, policy) => channels.some((c) => policy.sensitiveChannels.includes(c));
exports.hasSensitiveChannel = hasSensitiveChannel;
function approvalRequired(p, policy, flagOn) {
    const reasons = [];
    if (p.budgetTotalMinor > policy.approvalAboveMinor)
        reasons.push('BUDGET_ABOVE_THRESHOLD');
    if ((0, exports.hasSensitiveChannel)(p.channels, policy))
        reasons.push('SENSITIVE_CHANNEL');
    if (flagOn)
        reasons.push('POLICY_FLAG');
    return { required: reasons.length > 0, reasons };
}
const budgetIncreaseNeedsApproval = (oldTotal, newTotal, policy) => newTotal > oldTotal && (newTotal - oldTotal) * 100 > oldTotal * policy.budgetIncreaseApprovalPercent;
exports.budgetIncreaseNeedsApproval = budgetIncreaseNeedsApproval;
const utilisationBp = (approvedSpendMinor, budgetTotalMinor) => (budgetTotalMinor > 0 ? Math.floor((approvedSpendMinor * 10_000) / budgetTotalMinor) : 0);
exports.utilisationBp = utilisationBp;
const thresholdsToFire = (bp, thresholds, fired) => [...thresholds].sort((a, b) => a - b).filter((t) => bp >= t && !fired.includes(t));
exports.thresholdsToFire = thresholdsToFire;
const budgetExhausted = (approvedSpendMinor, budgetTotalMinor) => approvedSpendMinor >= budgetTotalMinor;
exports.budgetExhausted = budgetExhausted;
const dailyCapReached = (approvedSpendTodayMinor, budgetDailyMinor) => approvedSpendTodayMinor >= budgetDailyMinor;
exports.dailyCapReached = dailyCapReached;
function validateSpendLine(i, c, now, zone) {
    const errors = [];
    if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0)
        errors.push('The amount must be a positive whole number of minor units (a negative line is a correction by rejecting the original)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.day) || Number.isNaN(Date.parse(i.day)))
        errors.push('The day must be YYYY-MM-DD');
    else {
        if (i.day > (0, market_day_1.localDay)(now, zone))
            errors.push('Spend cannot be dated in the future');
        if (c.startsAt && i.day < (0, market_day_1.addDays)((0, market_day_1.localDay)(c.startsAt, zone), -1))
            errors.push('Spend cannot be dated before the campaign starts');
    }
    if (c.status === 'DRAFT' || c.status === 'PENDING_APPROVAL' || c.status === 'ARCHIVED')
        errors.push(`A ${c.status} campaign cannot receive spend`);
    return errors;
}
function plannedInMonth(c, month, zone) {
    if (!c.startsAt || !c.endsAt)
        return 0;
    const days = (0, market_day_1.daysBetween)(c.startsAt, new Date(c.endsAt.getTime() - 1), zone);
    if (!days.length)
        return 0;
    const inMonth = days.filter((d) => d.startsWith(month)).length;
    return Math.ceil((c.budgetTotalMinor * inMonth) / days.length);
}
function monthsOf(a, b, zone) { return [...new Set((0, market_day_1.daysBetween)(a, new Date(b.getTime() - 1), zone).map((d) => d.slice(0, 7)))]; }
function ceilingBreach(candidate, others, policy, zone) {
    if (!candidate.startsAt || !candidate.endsAt)
        return null;
    for (const month of monthsOf(candidate.startsAt, candidate.endsAt, zone)) {
        const planned = plannedInMonth(candidate, month, zone) + others.filter((o) => campaign_state_1.COUNTS_AGAINST_CEILING.includes(o.status)).reduce((s, o) => s + plannedInMonth(o, month, zone), 0);
        if (planned > policy.monthlyCeilingMinor)
            return { month, plannedMinor: planned, ceilingMinor: policy.monthlyCeilingMinor };
    }
    return null;
}
function validateAssetRef(ref, market, campaignId, policy) {
    if (typeof ref !== 'string' || ref.length < 3 || ref.length > 500)
        return 'The asset reference must be 3 to 500 characters';
    if (/^https:\/\//i.test(ref)) {
        let u;
        try {
            u = new URL(ref);
        }
        catch {
            return 'The asset URL is not valid';
        }
        if (u.username || u.password)
            return 'The asset URL must not contain credentials';
        return policy.creativeRules.allowedHttpsHosts.includes(u.hostname.toLowerCase()) ? null : 'The asset host is not on the allowlist';
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.includes('..') || ref.startsWith('/'))
        return 'Only an object-store key or an allowlisted https URL is accepted';
    const prefix = `${policy.creativeRules.assetKeyPrefix}${market.toLowerCase()}/${campaignId}/`;
    return ref.startsWith(prefix) && /^[A-Za-z0-9/_.-]+$/.test(ref) ? null : `An object-store key must start with ${prefix}`;
}
//# sourceMappingURL=campaign-guardrails.js.map