"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignRule = campaignRule;
const recommendation_types_1 = require("../recommendation.types");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
function campaignRule(i) {
    const comparable = i.campaigns.filter((c) => c.attendedNew >= recommendation_types_1.RECOMMENDATION_POLICY.k && c.cacMinor !== null && c.cacMinor > 0 && c.spendMinor >= recommendation_types_1.RECOMMENDATION_POLICY.spendFloorMinor);
    const med = comparable.length >= 3 ? median(comparable.map((c) => c.cacMinor)) : null;
    const out = [];
    for (const c of [...i.campaigns].sort((a, b) => (a.label < b.label ? -1 : 1))) {
        if (c.status !== 'ACTIVE' || c.activeDays < 14 || c.spendMinor < 2 * recommendation_types_1.RECOMMENDATION_POLICY.spendFloorMinor)
            continue;
        const none = c.attendedNew === 0;
        const costly = med !== null && c.attendedNew >= recommendation_types_1.RECOMMENDATION_POLICY.k && c.cacMinor !== null && c.cacMinor >= 2 * med;
        if (!none && !costly)
            continue;
        out.push({
            kind: 'PAUSE_CAMPAIGN', fingerprint: `pause:${c.label}`,
            payload: { campaignKey: c.label, channel: c.channel, activeDays: c.activeDays, spendMinor: c.spendMinor, attendedNew: c.attendedNew, cacMinor: c.cacMinor, medianCacMinor: med, finding: none ? 'NO_ATTENDED_PATIENTS' : 'CAC_TWICE_MEDIAN', window: i.window },
            rationale: none
                ? { en: `Campaign ${c.label} has spent ${c.spendMinor / 100} EGP over ${c.activeDays} days without one attended new patient. Consider pausing it and reviewing the links.`, ar: `الحملة ${c.label} صرفت ${c.spendMinor / 100} جنيه خلال ${c.activeDays} يوم من غير أي مريض جديد حضر. فكّر توقفها وتراجع الروابط.` }
                : { en: `Campaign ${c.label} costs ${c.cacMinor / 100} EGP per attended new patient, at least twice the median of comparable campaigns (${med / 100} EGP). Consider pausing it.`, ar: `الحملة ${c.label} تكلفتها ${c.cacMinor / 100} جنيه للمريض الجديد اللي حضر، ضعف وسيط الحملات المشابهة على الأقل (${med / 100} جنيه). فكّر توقفها.` },
            evidenceRefs: [{ source: 'campaign-performance', ref: c.label, window: `${i.window.from}..${i.window.to}` }],
            confidence: none ? 60 : Math.min(85, 50 + Math.floor(c.attendedNew / 4)),
        });
    }
    return out;
}
//# sourceMappingURL=campaign.rule.js.map