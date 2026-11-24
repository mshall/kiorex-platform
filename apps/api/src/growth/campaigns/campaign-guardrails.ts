import { CAMPAIGN_CHANNELS } from '@kiorex/contracts';
import { addDays, daysBetween, localDay } from './market-day';
import { COUNTS_AGAINST_CEILING, type CampaignStatus } from './campaign.state';

/** The CAMPAIGN_POLICY payload (contracts 1.12.0). */
export interface CampaignPolicy {
  approvalAboveMinor: number; budgetIncreaseApprovalPercent: number; monthlyCeilingMinor: number; dailyDefaultCapMinor: number; budgetAlertThresholdsBp: number[];
  allowedChannels: string[]; sensitiveChannels: string[]; utmNaming: { maxTokenLength: number; campaignPrefixMarket: boolean };
  creativeRules: { maxCreatives: number; allowedHttpsHosts: string[]; assetKeyPrefix: string }; autoExpiryGraceHours: number; requireReasonOnPause: boolean;
}

export interface MoneyPlan { budgetTotalMinor: number; budgetDailyMinor: number; currency: string; channels: readonly string[]; startsAt: Date | null; endsAt: Date | null }

/** Budget rules that hold for every campaign, whatever its state (GRW-P2-A). Returns machine paths + messages; empty = valid. */
export function validatePlan(p: MoneyPlan, policy: CampaignPolicy, marketCurrency: string): Array<{ path: string; message: string }> {
  const errors: Array<{ path: string; message: string }> = [];
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
  if (!int(p.budgetTotalMinor) || p.budgetTotalMinor <= 0) errors.push({ path: '/budgetTotalMinor', message: 'The total budget must be a positive whole number of minor units' });
  if (!int(p.budgetDailyMinor) || p.budgetDailyMinor <= 0) errors.push({ path: '/budgetDailyMinor', message: 'The daily cap must be a positive whole number of minor units' });
  if (int(p.budgetTotalMinor) && int(p.budgetDailyMinor) && p.budgetDailyMinor > p.budgetTotalMinor) errors.push({ path: '/budgetDailyMinor', message: 'The daily cap cannot exceed the total budget' });
  if (p.budgetTotalMinor > 2_000_000_000) errors.push({ path: '/budgetTotalMinor', message: 'The total budget is above the largest amount the system stores' });
  if (!marketCurrency) errors.push({ path: '/currency', message: 'The market has no currency configured' });
  else if (p.currency !== marketCurrency) errors.push({ path: '/currency', message: `The currency must be the market currency (${marketCurrency})` });
  if (!p.channels.length) errors.push({ path: '/channels', message: 'Choose at least one channel' });
  for (const ch of p.channels) {
    if (!(CAMPAIGN_CHANNELS as readonly string[]).includes(ch)) errors.push({ path: '/channels', message: `${ch} is not a channel` });
    else if (!policy.allowedChannels.includes(ch)) errors.push({ path: '/channels', message: `${ch} is not allowed by the campaign policy` });
  }
  if (new Set(p.channels).size !== p.channels.length) errors.push({ path: '/channels', message: 'A channel is listed twice' });
  if (p.startsAt && p.endsAt && p.endsAt.getTime() <= p.startsAt.getTime()) errors.push({ path: '/endsAt', message: 'The end must be after the start' });
  return errors;
}

export const hasSensitiveChannel = (channels: readonly string[], policy: CampaignPolicy) => channels.some((c) => policy.sensitiveChannels.includes(c));

/**
 * An approval is needed to activate when the total budget is above the policy threshold, or any channel is sensitive (WhatsApp and SMS marketing by default), or the
 * flag growth.campaign_approval_required is ON (the default: every activation then needs a second person). Switching the flag OFF never lifts the first two.
 */
export function approvalRequired(p: { budgetTotalMinor: number; channels: readonly string[] }, policy: CampaignPolicy, flagOn: boolean): { required: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (p.budgetTotalMinor > policy.approvalAboveMinor) reasons.push('BUDGET_ABOVE_THRESHOLD');
  if (hasSensitiveChannel(p.channels, policy)) reasons.push('SENSITIVE_CHANNEL');
  if (flagOn) reasons.push('POLICY_FLAG');
  return { required: reasons.length > 0, reasons };
}

/** A budget increase above the policy percentage needs its own approval. */
export const budgetIncreaseNeedsApproval = (oldTotal: number, newTotal: number, policy: CampaignPolicy) => newTotal > oldTotal && (newTotal - oldTotal) * 100 > oldTotal * policy.budgetIncreaseApprovalPercent;

/** Utilisation in basis points of the total budget, rounded down (99.99 percent is not 100). */
export const utilisationBp = (approvedSpendMinor: number, budgetTotalMinor: number) => (budgetTotalMinor > 0 ? Math.floor((approvedSpendMinor * 10_000) / budgetTotalMinor) : 0);
/** Thresholds crossed by this utilisation that have not fired yet (each fires once per campaign, idempotent). Ascending. */
export const thresholdsToFire = (bp: number, thresholds: readonly number[], fired: readonly number[]) => [...thresholds].sort((a, b) => a - b).filter((t) => bp >= t && !fired.includes(t));
export const budgetExhausted = (approvedSpendMinor: number, budgetTotalMinor: number) => approvedSpendMinor >= budgetTotalMinor;
export const dailyCapReached = (approvedSpendTodayMinor: number, budgetDailyMinor: number) => approvedSpendTodayMinor >= budgetDailyMinor;

/** Spend lines: positive, whole, not dated in the market-local future, and not before the campaign could have run. */
export function validateSpendLine(i: { day: string; amountMinor: number }, c: { startsAt: Date | null; status: CampaignStatus }, now: Date, zone: string): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(i.amountMinor) || i.amountMinor <= 0) errors.push('The amount must be a positive whole number of minor units (a negative line is a correction by rejecting the original)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.day) || Number.isNaN(Date.parse(i.day))) errors.push('The day must be YYYY-MM-DD');
  else {
    if (i.day > localDay(now, zone)) errors.push('Spend cannot be dated in the future');
    if (c.startsAt && i.day < addDays(localDay(c.startsAt, zone), -1)) errors.push('Spend cannot be dated before the campaign starts');
  }
  if (c.status === 'DRAFT' || c.status === 'PENDING_APPROVAL' || c.status === 'ARCHIVED') errors.push(`A ${c.status} campaign cannot receive spend`);
  return errors;
}

/** Share of a campaign's budget that falls in one calendar month (market-local), pro rata by days, rounded up (never under-counts the ceiling). */
export function plannedInMonth(c: { budgetTotalMinor: number; startsAt: Date | null; endsAt: Date | null }, month: string, zone: string): number {
  if (!c.startsAt || !c.endsAt) return 0;
  const days = daysBetween(c.startsAt, new Date(c.endsAt.getTime() - 1), zone); if (!days.length) return 0;
  const inMonth = days.filter((d) => d.startsWith(month)).length;
  return Math.ceil((c.budgetTotalMinor * inMonth) / days.length);
}
/** Months (YYYY-MM) a window touches. */
export function monthsOf(a: Date, b: Date, zone: string): string[] { return [...new Set(daysBetween(a, new Date(b.getTime() - 1), zone).map((d) => d.slice(0, 7)))]; }

/**
 * Monthly market ceiling over every ACTIVE and SCHEDULED campaign of the market (planned budget, pro rata by month). Returns the first month that would be exceeded,
 * with the figures, or null when the candidate fits.
 */
export function ceilingBreach(candidate: { budgetTotalMinor: number; startsAt: Date | null; endsAt: Date | null }, others: Array<{ status: CampaignStatus; budgetTotalMinor: number; startsAt: Date | null; endsAt: Date | null }>, policy: CampaignPolicy, zone: string): { month: string; plannedMinor: number; ceilingMinor: number } | null {
  if (!candidate.startsAt || !candidate.endsAt) return null;
  for (const month of monthsOf(candidate.startsAt, candidate.endsAt, zone)) {
    const planned = plannedInMonth(candidate, month, zone) + others.filter((o) => COUNTS_AGAINST_CEILING.includes(o.status)).reduce((s, o) => s + plannedInMonth(o, month, zone), 0);
    if (planned > policy.monthlyCeilingMinor) return { month, plannedMinor: planned, ceilingMinor: policy.monthlyCeilingMinor };
  }
  return null;
}

/** Creative asset references: an object-store key under the policy prefix for this campaign, or an https URL on an allowlisted host. Never a local path, data URI or http. */
export function validateAssetRef(ref: string, market: string, campaignId: string, policy: CampaignPolicy): string | null {
  if (typeof ref !== 'string' || ref.length < 3 || ref.length > 500) return 'The asset reference must be 3 to 500 characters';
  if (/^https:\/\//i.test(ref)) {
    let u: URL; try { u = new URL(ref); } catch { return 'The asset URL is not valid'; }
    if (u.username || u.password) return 'The asset URL must not contain credentials';
    return policy.creativeRules.allowedHttpsHosts.includes(u.hostname.toLowerCase()) ? null : 'The asset host is not on the allowlist';
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.includes('..') || ref.startsWith('/')) return 'Only an object-store key or an allowlisted https URL is accepted';
  const prefix = `${policy.creativeRules.assetKeyPrefix}${market.toLowerCase()}/${campaignId}/`;
  return ref.startsWith(prefix) && /^[A-Za-z0-9/_.-]+$/.test(ref) ? null : `An object-store key must start with ${prefix}`;
}
