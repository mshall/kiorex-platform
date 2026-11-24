import { RECOMMENDATION_POLICY as P, type RecommendationInputs, type RuleProposal } from '../recommendation.types';

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };

/**
 * Pause an under-performing campaign (GRW-P3-E). A running campaign is flagged when it has spent at least twice the floor over 14 days or more and EITHER attended nothing OR its CAC
 * (resting on at least k patients) is at least twice the median of the comparable campaigns. The proposal asks a human to look; it never pauses anything.
 */
export function campaignRule(i: RecommendationInputs): RuleProposal[] {
  const comparable = i.campaigns.filter((c) => c.attendedNew >= P.k && c.cacMinor !== null && c.cacMinor > 0 && c.spendMinor >= P.spendFloorMinor);
  const med = comparable.length >= 3 ? median(comparable.map((c) => c.cacMinor!)) : null;
  const out: RuleProposal[] = [];
  for (const c of [...i.campaigns].sort((a, b) => (a.label < b.label ? -1 : 1))) {
    if (c.status !== 'ACTIVE' || c.activeDays < 14 || c.spendMinor < 2 * P.spendFloorMinor) continue;
    const none = c.attendedNew === 0;
    const costly = med !== null && c.attendedNew >= P.k && c.cacMinor !== null && c.cacMinor >= 2 * med;
    if (!none && !costly) continue;
    out.push({
      kind: 'PAUSE_CAMPAIGN', fingerprint: `pause:${c.label}`,
      payload: { campaignKey: c.label, channel: c.channel, activeDays: c.activeDays, spendMinor: c.spendMinor, attendedNew: c.attendedNew, cacMinor: c.cacMinor, medianCacMinor: med, finding: none ? 'NO_ATTENDED_PATIENTS' : 'CAC_TWICE_MEDIAN', window: i.window },
      rationale: none
        ? { en: `Campaign ${c.label} has spent ${c.spendMinor / 100} EGP over ${c.activeDays} days without one attended new patient. Consider pausing it and reviewing the links.`, ar: `الحملة ${c.label} صرفت ${c.spendMinor / 100} جنيه خلال ${c.activeDays} يوم من غير أي مريض جديد حضر. فكّر توقفها وتراجع الروابط.` }
        : { en: `Campaign ${c.label} costs ${c.cacMinor! / 100} EGP per attended new patient, at least twice the median of comparable campaigns (${med! / 100} EGP). Consider pausing it.`, ar: `الحملة ${c.label} تكلفتها ${c.cacMinor! / 100} جنيه للمريض الجديد اللي حضر، ضعف وسيط الحملات المشابهة على الأقل (${med! / 100} جنيه). فكّر توقفها.` },
      evidenceRefs: [{ source: 'campaign-performance', ref: c.label, window: `${i.window.from}..${i.window.to}` }],
      confidence: none ? 60 : Math.min(85, 50 + Math.floor(c.attendedNew / 4)),
    });
  }
  return out;
}
