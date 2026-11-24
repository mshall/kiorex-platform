import { RECOMMENDATION_POLICY as P, type ChannelAggregate, type RecommendationInputs, type RuleProposal } from '../recommendation.types';

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));
const usable = (c: ChannelAggregate) => c.attendedNew >= P.k && c.spendMinor >= P.spendFloorMinor && c.cacMinor !== null && c.cacMinor > 0;

/**
 * Budget reallocation suggestion (GRW-P3-E). Compares channels with at least k attended new patients and spend over the floor. The basis is the LTV to CAC ratio when both channels have a
 * cohort estimate, else CAC alone (lower confidence). Suggests moving at most `maxShiftBp` of the weaker channel's spend to the stronger one. PURE and deterministic.
 */
export function budgetRule(i: RecommendationInputs): RuleProposal[] {
  const rows = i.channels.filter(usable);
  if (rows.length < 2) return [];
  const withLtv = rows.every((r) => r.ltvMinor !== null && r.ltvMinor > 0);
  const score = (r: ChannelAggregate) => (withLtv ? r.ltvMinor! / r.cacMinor! : 1 / r.cacMinor!); // higher is better
  const sorted = [...rows].sort((a, b) => score(b) - score(a) || (a.channel < b.channel ? -1 : 1));
  const best = sorted[0]!; const worst = sorted[sorted.length - 1]!;
  const ratioBp = Math.round((score(best) / score(worst)) * 10_000);
  if (ratioBp < P.minRatioBp) return [];
  const shiftBp = Math.min(P.maxShiftBp, Math.max(500, Math.round(((ratioBp - 10_000) / ratioBp) * P.maxShiftBp)));
  const shiftMinor = Math.floor((worst.spendMinor * shiftBp) / 10_000);
  const basis = withLtv ? 'LTV_CAC' : 'CAC';
  const confidence = Math.min(90, 40 + Math.min(30, Math.floor(Math.min(best.attendedNew, worst.attendedNew) / 5)) + (withLtv ? 20 : 0));
  return [{
    kind: 'REALLOCATE_BUDGET', fingerprint: `realloc:${worst.channel}>${best.channel}`,
    payload: { fromChannel: worst.channel, toChannel: best.channel, shiftBp, shiftMinor, basis, fromCacMinor: worst.cacMinor, toCacMinor: best.cacMinor, fromAttended: worst.attendedNew, toAttended: best.attendedNew, fromSpendMinor: worst.spendMinor, window: i.window },
    rationale: {
      en: `${best.channel} acquires new patients at ${pct(best.cacMinor!, worst.cacMinor!)}% of the cost of ${worst.channel} (cost per attended new patient ${best.cacMinor! / 100} against ${worst.cacMinor! / 100} EGP). Consider moving up to ${shiftBp / 100}% of ${worst.channel} spend to ${best.channel}.`,
      ar: `${best.channel} بتجيب مرضى جدد بتكلفة ${pct(best.cacMinor!, worst.cacMinor!)}% من تكلفة ${worst.channel} (تكلفة المريض الجديد اللي حضر ${best.cacMinor! / 100} مقابل ${worst.cacMinor! / 100} جنيه). فكّر تنقل لحد ${shiftBp / 100}% من إنفاق ${worst.channel} إلى ${best.channel}.`,
    },
    evidenceRefs: [{ source: 'channel-performance', ref: best.channel, window: `${i.window.from}..${i.window.to}` }, { source: 'channel-performance', ref: worst.channel, window: `${i.window.from}..${i.window.to}` }],
    confidence,
  }];
}
