/**
 * COM-4 RECOMMENDED commission defaults (founder instruction 27 Nov 2026: ship recommended starting values instead of "no number shipped").
 *
 * These are RECOMMENDED STARTING POINTS, not legal or pricing advice. Every value stays configurable from Ops (super admin, maker-checker, effective-dated, append-only) and can be changed
 * in production at any time; a seeded row is just version 1 of the same history, marked provenance SEEDED_DEFAULT. Rationale per value: Docs/COMMISSION_DEFAULTS.md.
 *
 * What is NEVER installed here: the counsel sign-off (COMMISSION_COUNSEL_SIGNOFF stays NOT_REVIEWED, so every real-money mode stays blocked; only a human records it) and any ACTIVE disclosure
 * wording (the AR and EN texts are installed as DRAFTs marked "draft pending counsel review"; nothing reaches an organisation until a super admin submits a version and a different one approves).
 * The installer is idempotent, safe to re-run, and never overwrites or supersedes a row an operator entered.
 */
import { newId } from '../common/ids';
import type { PrismaService } from '../prisma/prisma.service';
import { DISCLOSURE_KIND, disclosureProblems, type CommissionDisclosure } from './commission-policy';
import { rateProblems, type RateProduct, type RateSpec } from './commission-rate';
import { settingsProblems, type CollectionSettings } from './commission-collect';

export const SEEDED_DEFAULT = 'SEEDED_DEFAULT';
/** Bump when the recommended values change: a newer set is appended ONLY where the newest row of that scope is still an untouched seeded row. */
export const DEFAULTS_VERSION = 1;
export const SEED_ACTOR = 'system:seeded-default';
export const SEED_DECIDER = 'system:seeded-default-activation';
export const SEED_MARKET = 'EG';
export const SEED_NOTE = `${SEEDED_DEFAULT} v${DEFAULTS_VERSION}: recommended starting value, not legal or pricing advice; change it through Ops (maker-checker)`;

const EGP = (pounds: number) => pounds * 100;

/** Shared collection and dunning parameters (all clamped by the same bounds as an operator entry). */
const COMMON = {
  mode: 'NET_FROM_PAYOUT', currency: 'EGP', rounding: 'HALF_UP',
  minCollectMinor: EGP(50), graceDays: 3, retryDays: [3, 7, 14], invoiceDueDays: 14, reminderDays: [-3, 0, 7, 14], disputeWindowDays: 14, savedMethodChargeAllowed: false,
} as const;

/** Recommended default rate per organisation type, Egypt, EGP minor units. PERCENT is of the marketplace-attributed service amount (Clinic) or order amount (Pharmacy goods, Lab tests). */
export const RECOMMENDED_RATES: Record<RateProduct, RateSpec> = {
  CLINIC: { feeType: 'PERCENT', percentBps: 300, flatMinor: null, minMinor: EGP(10), maxMinor: EGP(75), ...COMMON, retryDays: [...COMMON.retryDays], reminderDays: [...COMMON.reminderDays] },
  PHARMACY: { feeType: 'PERCENT', percentBps: 200, flatMinor: null, minMinor: EGP(5), maxMinor: EGP(100), ...COMMON, retryDays: [...COMMON.retryDays], reminderDays: [...COMMON.reminderDays] },
  LAB: { feeType: 'PERCENT', percentBps: 300, flatMinor: null, minMinor: EGP(10), maxMinor: EGP(100), ...COMMON, retryDays: [...COMMON.retryDays], reminderDays: [...COMMON.reminderDays] },
};

/** Collection settings of the market that the rate does not carry (cycle and cut-off). The rate's own fields win field by field. */
export const RECOMMENDED_MARKET_SETTINGS: CollectionSettings = { mode: 'NET_FROM_PAYOUT', cycle: 'MONTHLY', cutoffDay: 1, graceDays: 3, retryDays: [3, 7, 14], minCollectMinor: EGP(50), invoiceDueDays: 14 };

const DRAFT_EN = 'Draft pending counsel review.';
const DRAFT_AR = 'مسودة بانتظار مراجعة المستشار القانوني.';

/**
 * Neutral plain-language draft wording. It names no figure on purpose (the rate is shown on the same page and may change), makes no legal claim and says nothing about tax.
 * Marked "draft pending counsel review" inside the text itself, so the marker travels with the text if it is ever published.
 */
export const RECOMMENDED_DISCLOSURE: CommissionDisclosure = {
  rateDisclosure: {
    en: `${DRAFT_EN}\nKiorex charges a commission on bookings and orders that came to you through the Kiorex marketplace. The rate for your organisation type, any rate agreed specifically for your organisation, and the date each rate applies from are shown on this page. A change applies only from its start date and never changes a commission already recorded.`,
    ar: `${DRAFT_AR}\nتحصّل كيوريكس عمولة على الحجوزات والطلبات التي وصلت إليك عبر منصة كيوريكس. تجد في هذه الصفحة النسبة الخاصة بنوع منشأتك، وأي نسبة متفق عليها لمنشأتك تحديدًا، وتاريخ بدء سريان كل نسبة. أي تغيير يسري من تاريخ بدايته فقط ولا يغيّر عمولة سبق تسجيلها.`,
  },
  termsSummary: {
    en: `${DRAFT_EN}\nHow it is collected: the commission is normally deducted from the amount Kiorex pays out to your bank account, so there is usually nothing extra to pay. Visits paid in cash at the clinic are still counted, and their commission is deducted in the same way when the period is settled.\nSettlement: each settlement period lists what was earned, what was deducted and what remains. If the amount is too small to deduct, or a deduction is not possible, it carries over to the next period or is sent to you as an invoice.\nWhere to see it: open the commission statement in your Kiorex or Kiorly account to see every commission, its status and the settlement that included it. You can raise a question about any line within the dispute period shown there.`,
    ar: `${DRAFT_AR}\nطريقة التحصيل: تُخصم العمولة عادةً من المبلغ الذي تحوّله كيوريكس إلى حسابك البنكي، لذلك لا يوجد عادةً شيء إضافي لتدفعه. الزيارات المدفوعة نقدًا في العيادة تُحتسب أيضًا، وتُخصم عمولتها بالطريقة نفسها عند تسوية الفترة.\nالتسوية: تعرض كل فترة تسوية ما تم استحقاقه وما تم خصمه وما تبقى. إذا كان المبلغ صغيرًا جدًا للخصم، أو تعذّر الخصم، فإنه يُرحَّل إلى الفترة التالية أو يُرسَل إليك في فاتورة.\nأين تراها: افتح كشف العمولات في حسابك على كيوريكس أو كيورلي لترى كل عمولة وحالتها والتسوية التي شملتها. يمكنك الاستفسار عن أي بند خلال مدة الاعتراض الظاهرة هناك.`,
  },
  /** Recommended: the reason of an override is hidden from the organisation (configurable in Ops). */
  showOverrideReason: false,
};

/** Every shipped value must pass the same validators as an operator entry; the unit test calls this. */
export function recommendedProblems(): string[] {
  const out: string[] = [];
  for (const [p, spec] of Object.entries(RECOMMENDED_RATES)) for (const m of rateProblems(spec)) out.push(`${p}: ${m}`);
  for (const m of settingsProblems(RECOMMENDED_MARKET_SETTINGS)) out.push(`market settings: ${m}`);
  for (const m of disclosureProblems(RECOMMENDED_DISCLOSURE)) out.push(`disclosure: ${m}`);
  return out;
}

/** Whether the installer runs at all: COMMISSION_DEFAULTS_SEED=false skips it (default: on). */
export const defaultsSeedEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => !['false', '0', 'off', 'no'].includes((env.COMMISSION_DEFAULTS_SEED ?? '').trim().toLowerCase());

export interface InstallReport { rates: Record<string, 'INSTALLED' | 'APPENDED' | 'KEPT_OPERATOR_ROW' | 'KEPT_CURRENT'>; marketSettings: string; disclosure: string; counselSignoff: 'UNTOUCHED' }

type Db = Pick<PrismaService, 'commissionRatePolicy' | 'commissionPolicy' | 'growthConfigVersion' | 'auditLog'>;
const isDup = (e: unknown) => (e as { code?: string })?.code === 'P2002';
/** The growth config checksum is a hash of the canonical payload; the installer takes it from the config service module to stay identical. */
export type Checksum = (payload: unknown) => string;

/**
 * Install the recommended defaults. Idempotent: a scope that already has ANY row (operator, pending, rejected, or a seeded row of this version) is left alone. A newer defaults version is appended only
 * where the newest row of the scope is still a seeded row of an older version and nothing is pending. Never touches the counsel sign-off. Returns what it did.
 */
export async function installCommissionDefaults(db: Db, checksum: Checksum, now = new Date()): Promise<InstallReport> {
  const bad = recommendedProblems();
  if (bad.length) throw new Error(`recommended commission defaults are invalid: ${bad.join('; ')}`);
  const report: InstallReport = { rates: {}, marketSettings: 'KEPT_OPERATOR_ROW', disclosure: 'KEPT_OPERATOR_ROW', counselSignoff: 'UNTOUCHED' };

  for (const product of ['CLINIC', 'PHARMACY', 'LAB'] as const) {
    const rows = await db.commissionRatePolicy.findMany({ where: { scope: 'DEFAULT', scopeRef: product }, orderBy: { version: 'desc' }, take: 2, select: { version: true, status: true, provenance: true, seedVersion: true } });
    const newest = rows[0];
    let how: InstallReport['rates'][string];
    if (!newest) how = 'INSTALLED';
    else if (newest.provenance === SEEDED_DEFAULT && (newest.seedVersion ?? 0) < DEFAULTS_VERSION && newest.status === 'ACTIVE') how = 'APPENDED';
    else { report.rates[product] = newest.provenance === SEEDED_DEFAULT ? 'KEPT_CURRENT' : 'KEPT_OPERATOR_ROW'; continue; }
    try {
      const row = await db.commissionRatePolicy.create({ data: { id: newId('crp'), scope: 'DEFAULT', product, scopeRef: product, kind: 'RATE', version: (newest?.version ?? 0) + 1, status: 'ACTIVE', spec: RECOMMENDED_RATES[product] as unknown as object, effectiveFrom: now, proposedBy: SEED_ACTOR, proposedAt: now, decidedBy: SEED_DECIDER, decidedAt: now, decisionNote: SEED_NOTE, provenance: SEEDED_DEFAULT, seedVersion: DEFAULTS_VERSION } });
      await db.auditLog.create({ data: { actor: SEED_ACTOR, action: 'commission.defaults_installed', resource: 'CommissionRatePolicy', resourceId: row.id, metadata: { product, version: row.version, seedVersion: DEFAULTS_VERSION, provenance: SEEDED_DEFAULT, spec: RECOMMENDED_RATES[product] } as object } });
      report.rates[product] = how;
    } catch (e) { if (!isDup(e)) throw e; report.rates[product] = 'KEPT_OPERATOR_ROW'; } // a concurrent installer or operator took the version number
  }

  const ms = await db.commissionPolicy.findFirst({ where: { scope: 'MARKET', scopeRef: SEED_MARKET }, orderBy: { version: 'desc' }, select: { version: true, status: true, provenance: true, seedVersion: true } });
  if (!ms || (ms.provenance === SEEDED_DEFAULT && (ms.seedVersion ?? 0) < DEFAULTS_VERSION && ms.status === 'ACTIVE')) {
    try {
      if (ms) await db.commissionPolicy.updateMany({ where: { scope: 'MARKET', scopeRef: SEED_MARKET, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
      const row = await db.commissionPolicy.create({ data: { id: newId('cpo'), scope: 'MARKET', scopeRef: SEED_MARKET, version: (ms?.version ?? 0) + 1, status: 'ACTIVE', settings: RECOMMENDED_MARKET_SETTINGS as unknown as object, note: SEED_NOTE, provenance: SEEDED_DEFAULT, seedVersion: DEFAULTS_VERSION, proposedBy: SEED_ACTOR, proposedAt: now, decidedBy: SEED_DECIDER, decidedAt: now, decisionNote: SEED_NOTE } });
      await db.auditLog.create({ data: { actor: SEED_ACTOR, action: 'commission.defaults_installed', resource: 'CommissionPolicy', resourceId: row.id, metadata: { market: SEED_MARKET, version: row.version, seedVersion: DEFAULTS_VERSION, provenance: SEEDED_DEFAULT, settings: RECOMMENDED_MARKET_SETTINGS } as object } });
      report.marketSettings = ms ? 'APPENDED' : 'INSTALLED';
    } catch (e) { if (!isDup(e)) throw e; }
  } else report.marketSettings = ms.provenance === SEEDED_DEFAULT ? 'KEPT_CURRENT' : 'KEPT_OPERATOR_ROW';

  // disclosure drafts: only when this market has no disclosure version at all (operator or seeded). A DRAFT never reaches an organisation.
  const dis = await db.growthConfigVersion.findFirst({ where: { kind: DISCLOSURE_KIND, scope: 'MARKET', scopeId: SEED_MARKET }, orderBy: { version: 'desc' }, select: { version: true, ticket: true } });
  if (!dis) {
    try {
      const row = await db.growthConfigVersion.create({ data: { kind: DISCLOSURE_KIND, scope: 'MARKET', scopeId: SEED_MARKET, version: 1, status: 'DRAFT', payload: RECOMMENDED_DISCLOSURE as unknown as object, effectiveFrom: null, createdBy: SEED_ACTOR, ticket: SEEDED_DEFAULT, reason: 'draft pending counsel review (SEEDED_DEFAULT)', checksum: checksum(RECOMMENDED_DISCLOSURE) } });
      await db.auditLog.create({ data: { actor: SEED_ACTOR, action: 'commission.defaults_installed', resource: 'GrowthConfigVersion', resourceId: row.id, metadata: { kind: DISCLOSURE_KIND, market: SEED_MARKET, version: 1, status: 'DRAFT', provenance: SEEDED_DEFAULT } as object } });
      report.disclosure = 'INSTALLED_DRAFT';
    } catch (e) { if (!isDup(e)) throw e; }
  } else report.disclosure = dis.ticket === SEEDED_DEFAULT ? 'KEPT_CURRENT' : 'KEPT_OPERATOR_ROW';
  return report;
}
