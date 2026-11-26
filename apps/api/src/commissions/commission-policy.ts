/**
 * COM-3 commission POLICY gates: pure domain (no I/O), deterministic and unit-tested.
 *
 * Founder decision (binding): everything that is still a "numbers and counsel" decision is CONFIGURABLE from the super admin console and NEVER hardcoded. Nothing legal is shipped:
 *  - a funds-flow counsel sign-off record per market gates which commission collection modes and which payout / settlement routes may run in REAL mode (mock is always allowed).
 *    The default is NOT_REVIEWED, which keeps every real-money mode blocked with a visible reason;
 *  - provider-facing disclosure texts (rate disclosure, commission terms summary; Arabic and English) are free text entered by the super admin or counsel. Empty = "wording not set":
 *    the provider page hides the text block and still shows the numbers. Whether the reason of an override is visible to the organisation is a boolean setting (default: hidden).
 * Both ride the maker-checker GrowthConfigVersion pattern (kinds COMMISSION_COUNSEL_SIGNOFF and COMMISSION_DISCLOSURE, MARKET scope): a different super admin approves, append-only, effective-dated, audited.
 */
import { COLLECTION_MODES, type CollectionMode } from './commission-collect';

export const COUNSEL_KIND = 'COMMISSION_COUNSEL_SIGNOFF';
export const DISCLOSURE_KIND = 'COMMISSION_DISCLOSURE';
export const COMMISSION_POLICY_KINDS = [COUNSEL_KIND, DISCLOSURE_KIND] as const;

export const COUNSEL_STATUSES = ['NOT_REVIEWED', 'APPROVED_WITH_CONDITIONS', 'APPROVED', 'REJECTED'] as const;
export type CounselStatus = (typeof COUNSEL_STATUSES)[number];
/** Payout / settlement routes a market may run in real mode: the payment rails of the Integrations Control Center. */
export const PAYOUT_ROUTES = ['PAYMOB', 'FAWRY', 'INSTAPAY', 'CARD_GATEWAY', 'BANK_IPN'] as const;
export type PayoutRoute = (typeof PAYOUT_ROUTES)[number];

export interface CounselSignoff {
  status: CounselStatus;
  reviewerName: string;
  /** Reference of the signed document (id, file number, link): an identifier, never the document. */
  documentId: string;
  /** ISO date (YYYY-MM-DD) of the review. */
  reviewedOn: string;
  conditions: string;
  /** Real-mode collection modes counsel approved for this market. Only effective under APPROVED or APPROVED_WITH_CONDITIONS. */
  collectionModes: CollectionMode[];
  /** Real-mode payout / settlement routes counsel approved for this market. Same rule. */
  payoutRoutes: PayoutRoute[];
}
export const COUNSEL_DEFAULT: CounselSignoff = { status: 'NOT_REVIEWED', reviewerName: '', documentId: '', reviewedOn: '', conditions: '', collectionModes: [], payoutRoutes: [] };

export interface BilingualText { en: string; ar: string }
export interface CommissionDisclosure { rateDisclosure: BilingualText; termsSummary: BilingualText; showOverrideReason: boolean }
/** Code fallback when no version is in force: every text is empty and the reason of an override is hidden. (COM-4 installs AR/EN wording only as DRAFTs pending counsel review, never as a version in force.) */
export const DISCLOSURE_DEFAULT: CommissionDisclosure = { rateDisclosure: { en: '', ar: '' }, termsSummary: { en: '', ar: '' }, showOverrideReason: false };

export const MAX_TEXT = 4000;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const only = (o: Record<string, unknown>, allowed: readonly string[], at: string, out: string[]) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) out.push(`${at}/${k} is not allowed`); };
const noMarkup = (v: string) => !/[<>]/.test(v);

export function counselProblems(raw: unknown): string[] {
  const out: string[] = [];
  if (!isObj(raw)) return ['payload must be an object'];
  only(raw, Object.keys(COUNSEL_DEFAULT), '', out);
  if (!COUNSEL_STATUSES.includes(raw.status as CounselStatus)) { out.push('/status must be NOT_REVIEWED, APPROVED_WITH_CONDITIONS, APPROVED or REJECTED'); return out; }
  for (const [k, max] of [['reviewerName', 120], ['documentId', 120], ['conditions', 2000]] as const) {
    const v = raw[k]; if (v === undefined) continue;
    if (typeof v !== 'string' || v.length > max) out.push(`/${k} must be text of at most ${max} characters`); else if (!noMarkup(v)) out.push(`/${k} must not contain markup`);
  }
  const date = raw.reviewedOn; if (date !== undefined && date !== '' && !(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)))) out.push('/reviewedOn must be a date YYYY-MM-DD');
  const modes = raw.collectionModes ?? []; const routes = raw.payoutRoutes ?? [];
  if (!Array.isArray(modes) || !modes.every((m) => COLLECTION_MODES.includes(m as CollectionMode)) || new Set(modes).size !== modes.length) out.push('/collectionModes must be a list of distinct collection modes');
  if (!Array.isArray(routes) || !routes.every((m) => PAYOUT_ROUTES.includes(m as PayoutRoute)) || new Set(routes).size !== routes.length) out.push('/payoutRoutes must be a list of distinct payout routes');
  const s = raw.status as CounselStatus; const filled = (k: string) => typeof raw[k] === 'string' && (raw[k] as string).trim().length > 0;
  const anyApproved = (Array.isArray(modes) && modes.length > 0) || (Array.isArray(routes) && routes.length > 0);
  if (s === 'APPROVED' || s === 'APPROVED_WITH_CONDITIONS') {
    for (const k of ['reviewerName', 'documentId', 'reviewedOn']) if (!filled(k)) out.push(`/${k} is required when counsel has approved`);
  }
  if (s === 'APPROVED_WITH_CONDITIONS' && !filled('conditions')) out.push('/conditions is required for APPROVED_WITH_CONDITIONS');
  if ((s === 'NOT_REVIEWED' || s === 'REJECTED') && anyApproved) out.push('/collectionModes and /payoutRoutes must be empty unless counsel has approved');
  if (s === 'REJECTED' && !filled('reviewerName')) out.push('/reviewerName is required for a REJECTED record');
  return out;
}
export const parseCounsel = (raw: unknown): CounselSignoff => {
  const o = isObj(raw) ? raw : {};
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  return {
    status: COUNSEL_STATUSES.includes(o.status as CounselStatus) ? (o.status as CounselStatus) : 'NOT_REVIEWED', reviewerName: str('reviewerName'), documentId: str('documentId'), reviewedOn: str('reviewedOn'), conditions: str('conditions'),
    collectionModes: Array.isArray(o.collectionModes) ? (o.collectionModes.filter((m) => COLLECTION_MODES.includes(m as CollectionMode)) as CollectionMode[]) : [],
    payoutRoutes: Array.isArray(o.payoutRoutes) ? (o.payoutRoutes.filter((m) => PAYOUT_ROUTES.includes(m as PayoutRoute)) as PayoutRoute[]) : [],
  };
};

export function disclosureProblems(raw: unknown): string[] {
  const out: string[] = [];
  if (!isObj(raw)) return ['payload must be an object'];
  only(raw, Object.keys(DISCLOSURE_DEFAULT), '', out);
  for (const k of ['rateDisclosure', 'termsSummary'] as const) {
    const v = raw[k]; if (v === undefined) continue;
    if (!isObj(v)) { out.push(`/${k} must be an object with en and ar`); continue; }
    only(v, ['en', 'ar'], `/${k}`, out);
    for (const l of ['en', 'ar']) {
      const t = v[l]; if (t === undefined) continue;
      if (typeof t !== 'string' || t.length > MAX_TEXT) out.push(`/${k}/${l} must be text of at most ${MAX_TEXT} characters`); else if (!noMarkup(t)) out.push(`/${k}/${l} must not contain markup`);
    }
  }
  if (raw.showOverrideReason !== undefined && typeof raw.showOverrideReason !== 'boolean') out.push('/showOverrideReason must be true or false');
  return out;
}
export const parseDisclosure = (raw: unknown): CommissionDisclosure => {
  const o = isObj(raw) ? raw : {};
  const t = (v: unknown): BilingualText => { const x = isObj(v) ? v : {}; return { en: typeof x.en === 'string' ? x.en : '', ar: typeof x.ar === 'string' ? x.ar : '' }; };
  return { rateDisclosure: t(o.rateDisclosure), termsSummary: t(o.termsSummary), showOverrideReason: o.showOverrideReason === true };
};
/** True when at least one language of one text is set. "Wording not set" is the opposite. */
export const wordingSet = (d: CommissionDisclosure): boolean => [d.rateDisclosure.en, d.rateDisclosure.ar, d.termsSummary.en, d.termsSummary.ar].some((x) => x.trim().length > 0);
/** Languages missing for each text (what counsel still has to write). */
export const missingLanguages = (d: CommissionDisclosure): { rateDisclosure: ('en' | 'ar')[]; termsSummary: ('en' | 'ar')[] } => {
  const miss = (t: BilingualText) => (['en', 'ar'] as const).filter((l) => !t[l].trim());
  return { rateDisclosure: miss(d.rateDisclosure), termsSummary: miss(d.termsSummary) };
};

// ───────────────────────── the gate ─────────────────────────
export type GateKind = 'COLLECTION_MODE' | 'PAYOUT_ROUTE';
export type GateReason = 'MOCK_MODE' | 'COUNSEL_NOT_REVIEWED' | 'COUNSEL_REJECTED' | 'NOT_IN_APPROVED_LIST' | 'APPROVED' | 'APPROVED_WITH_CONDITIONS';
export interface GateDecision { allowed: boolean; reason: GateReason; status: CounselStatus; kind: GateKind; key: string; market: string; conditions: string | null }

/**
 * May `key` (a collection mode or a payout route) run in REAL mode for a market? Mock is always allowed. In real mode the record must be APPROVED or APPROVED_WITH_CONDITIONS AND list the key:
 * NOT_REVIEWED (the default) and REJECTED keep every real-money mode closed. Pure: callers pass the record in force.
 */
export function gateDecision(record: CounselSignoff | null | undefined, i: { kind: GateKind; key: string; market: string; real: boolean }): GateDecision {
  const r = record ?? COUNSEL_DEFAULT;
  const base = { status: r.status, kind: i.kind, key: i.key, market: i.market, conditions: r.status === 'APPROVED_WITH_CONDITIONS' ? r.conditions : null };
  if (!i.real) return { ...base, allowed: true, reason: 'MOCK_MODE' };
  if (r.status === 'NOT_REVIEWED') return { ...base, allowed: false, reason: 'COUNSEL_NOT_REVIEWED' };
  if (r.status === 'REJECTED') return { ...base, allowed: false, reason: 'COUNSEL_REJECTED' };
  const list: readonly string[] = i.kind === 'COLLECTION_MODE' ? r.collectionModes : r.payoutRoutes;
  if (!list.includes(i.key)) return { ...base, allowed: false, reason: 'NOT_IN_APPROVED_LIST' };
  return { ...base, allowed: true, reason: r.status };
}
