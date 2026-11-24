import { FRAUD_RULE_IDS, FRAUD_SURFACES, type FraudAction, type FraudBand, type FraudRuleId, type FraudSurface, type FraudThresholds } from './signals';

/**
 * `FRAUD_RULES` growth configuration (contracts 1.13.0 kind; reader here is tolerant like the SEO extension keys: until the vendored contracts carry the kind, the
 * defaults below are in force and a stored row is validated here). Defaults are PROPOSED_DEFAULT. Shadow by default (AD-11): `enforce` false.
 * Effective enforcement of one rule = master `enforce` AND the rule's own `enforce`, flipped through the maker-checker like every config.
 */
export interface FraudRuleCfg { enabled: boolean; weight: number; cap: number; enforce: boolean }
export type SurfaceActions = Partial<Record<Exclude<FraudBand, 'ALLOW'>, FraudAction>>;
export interface FraudRulesConfig {
  enforce: boolean;
  bands: { review: number; hold: number };
  /** each next-strongest signal counts this much of its own contribution: 0.6 means 1, 0.6, 0.36 ... (diminishing returns) */
  diminishing: number;
  reviewSlaHours: number;
  /** a hold with no decision is released after this many days (a forgotten review never strands a patient) */
  holdDays: number;
  suspendDays: number;
  appealWindowDays: number;
  banMaxDays: number;
  /** a decision is a two-person decision when it moves money (reverses a reward) */
  twoPersonOnMoney: boolean;
  rules: Record<FraudRuleId, FraudRuleCfg>;
  actions: Record<FraudSurface, SurfaceActions>;
  thresholds: FraudThresholds;
}

const R = (weight: number, cap = weight): FraudRuleCfg => ({ enabled: true, weight, cap, enforce: false });

export const FRAUD_RULES_DEFAULTS = (): FraudRulesConfig => ({
  enforce: false,
  bands: { review: 30, hold: 70 },
  diminishing: 0.6,
  reviewSlaHours: 48,
  holdDays: 30,
  suspendDays: 30,
  appealWindowDays: 14,
  banMaxDays: 180,
  twoPersonOnMoney: true,
  rules: {
    r_self: R(100), r_dup: R(90), r_bot: R(85), r_farm: R(70, 75), r_fakebooking: R(75, 80), r_collusion: R(85, 90), r_cancel: R(80), r_redeem: R(90),
    r_touch_burst: R(40, 50), r_widget_abuse: R(90, 100), r_lt_replay: R(80),
  },
  actions: {
    REFERRAL_CLAIM: { REVIEW: 'OPEN_CASE', HOLD: 'REJECT_CLAIM' },
    REWARD: { REVIEW: 'OPEN_CASE', HOLD: 'HOLD_REWARD' },
    REFERRAL_ELIGIBILITY: { REVIEW: 'OPEN_CASE', HOLD: 'SUSPEND_REFERRAL' },
    WIDGET: { REVIEW: 'OPEN_CASE', HOLD: 'THROTTLE_ORIGIN' },
    TOUCH: { REVIEW: 'OPEN_CASE', HOLD: 'QUARANTINE_TOUCH' },
    PROVIDER_REVIEW: { REVIEW: 'OPEN_PROVIDER_REVIEW', HOLD: 'OPEN_PROVIDER_REVIEW' },
  },
  thresholds: { touchBurstPerMinute: 20, widgetOriginMismatches: 3, widgetDistinctOriginsPerKey1h: 5, widgetRequestsPerOrigin5m: 600, widgetTokenReplays: 2, ltUseCountLimit: 5, ltDistinctSubjectsLimit: 3 },
});

const num = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
const int = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface FraudConfigValidation { valid: boolean; errors: string[] }

/** Validate a stored FRAUD_RULES payload (the maker-checker calls it before storing). Pure; never throws. */
export function validateFraudRules(payload: unknown): FraudConfigValidation {
  const errors: string[] = [];
  if (!isObj(payload)) return { valid: false, errors: ['payload must be an object'] };
  if (payload.enforce !== undefined && typeof payload.enforce !== 'boolean') errors.push('enforce must be a boolean');
  if (payload.bands !== undefined) {
    if (!isObj(payload.bands)) errors.push('bands must be an object');
    else {
      const b = payload.bands; const review = int(b.review, 1, 99); const hold = int(b.hold, 2, 100);
      if (b.review !== undefined && review === undefined) errors.push('bands.review must be an integer 1 to 99');
      if (b.hold !== undefined && hold === undefined) errors.push('bands.hold must be an integer 2 to 100');
      if (review !== undefined && hold !== undefined && review >= hold) errors.push('bands.review must be below bands.hold');
    }
  }
  for (const [k, lo, hi] of [['diminishing', 0, 1], ['reviewSlaHours', 1, 720], ['holdDays', 1, 365], ['suspendDays', 1, 365], ['appealWindowDays', 1, 90], ['banMaxDays', 1, 730]] as const) {
    if (payload[k] !== undefined && (k === 'diminishing' ? num(payload[k], lo, hi) : int(payload[k], lo, hi)) === undefined) errors.push(`${k} must be ${k === 'diminishing' ? 'a number' : 'an integer'} from ${lo} to ${hi}`);
  }
  if (payload.twoPersonOnMoney !== undefined && payload.twoPersonOnMoney !== true) errors.push('twoPersonOnMoney cannot be switched off');
  if (payload.rules !== undefined) {
    if (!isObj(payload.rules)) errors.push('rules must be an object');
    else for (const [id, v] of Object.entries(payload.rules)) {
      if (!(FRAUD_RULE_IDS as readonly string[]).includes(id)) { errors.push(`unknown rule ${id}`); continue; }
      if (!isObj(v)) { errors.push(`rules.${id} must be an object`); continue; }
      if (v.weight !== undefined && int(v.weight, 0, 100) === undefined) errors.push(`rules.${id}.weight must be an integer 0 to 100`);
      if (v.cap !== undefined && int(v.cap, 0, 100) === undefined) errors.push(`rules.${id}.cap must be an integer 0 to 100`);
      if (v.enabled !== undefined && typeof v.enabled !== 'boolean') errors.push(`rules.${id}.enabled must be a boolean`);
      if (v.enforce !== undefined && typeof v.enforce !== 'boolean') errors.push(`rules.${id}.enforce must be a boolean`);
    }
  }
  if (payload.actions !== undefined) {
    if (!isObj(payload.actions)) errors.push('actions must be an object');
    else for (const [surface, v] of Object.entries(payload.actions)) {
      if (!(FRAUD_SURFACES as readonly string[]).includes(surface)) { errors.push(`unknown surface ${surface}`); continue; }
      if (!isObj(v)) { errors.push(`actions.${surface} must be an object`); continue; }
      const allowed = ALLOWED_ACTIONS[surface as FraudSurface];
      for (const [band, a] of Object.entries(v)) {
        if (band !== 'REVIEW' && band !== 'HOLD') errors.push(`actions.${surface}.${band}: only REVIEW and HOLD carry actions`);
        else if (typeof a !== 'string' || !allowed.includes(a as FraudAction)) errors.push(`actions.${surface}.${band} must be one of ${allowed.join(', ')}`);
      }
    }
  }
  if (payload.thresholds !== undefined && !isObj(payload.thresholds)) errors.push('thresholds must be an object');
  else if (isObj(payload.thresholds)) for (const [k, v] of Object.entries(payload.thresholds)) {
    if (!(k in FRAUD_RULES_DEFAULTS().thresholds)) errors.push(`unknown threshold ${k}`);
    else if (int(v, 1, 100_000) === undefined) errors.push(`thresholds.${k} must be an integer 1 to 100000`);
  }
  return { valid: errors.length === 0, errors };
}

/** Actions each surface may take: a surface can never be given an action that belongs elsewhere or reaches attribution, commission, booking or a provider. */
export const ALLOWED_ACTIONS: Record<FraudSurface, readonly FraudAction[]> = {
  REFERRAL_CLAIM: ['NONE', 'OPEN_CASE', 'REJECT_CLAIM'],
  REWARD: ['NONE', 'OPEN_CASE', 'HOLD_REWARD'],
  REFERRAL_ELIGIBILITY: ['NONE', 'OPEN_CASE', 'SUSPEND_REFERRAL'],
  WIDGET: ['NONE', 'OPEN_CASE', 'THROTTLE_ORIGIN'],
  TOUCH: ['NONE', 'OPEN_CASE', 'QUARANTINE_TOUCH'],
  PROVIDER_REVIEW: ['NONE', 'OPEN_CASE', 'OPEN_PROVIDER_REVIEW'],
};

/** Merge a stored payload over `base`; invalid pieces are ignored one by one so a bad row never takes scoring down. */
export function mergeFraudRules(base: FraudRulesConfig, payload: unknown): FraudRulesConfig {
  if (!isObj(payload)) return base;
  const out: FraudRulesConfig = { ...base, bands: { ...base.bands }, rules: { ...base.rules }, actions: { ...base.actions }, thresholds: { ...base.thresholds }, twoPersonOnMoney: true };
  if (typeof payload.enforce === 'boolean') out.enforce = payload.enforce;
  if (isObj(payload.bands)) {
    const review = int(payload.bands.review, 1, 99) ?? out.bands.review; const hold = int(payload.bands.hold, 2, 100) ?? out.bands.hold;
    if (review < hold) out.bands = { review, hold };
  }
  out.diminishing = num(payload.diminishing, 0, 1) ?? out.diminishing;
  out.reviewSlaHours = int(payload.reviewSlaHours, 1, 720) ?? out.reviewSlaHours;
  out.holdDays = int(payload.holdDays, 1, 365) ?? out.holdDays;
  out.suspendDays = int(payload.suspendDays, 1, 365) ?? out.suspendDays;
  out.appealWindowDays = int(payload.appealWindowDays, 1, 90) ?? out.appealWindowDays;
  out.banMaxDays = int(payload.banMaxDays, 1, 730) ?? out.banMaxDays;
  if (isObj(payload.rules)) {
    for (const id of FRAUD_RULE_IDS) {
      const v = payload.rules[id]; if (!isObj(v)) continue;
      const cur = out.rules[id];
      out.rules[id] = { enabled: typeof v.enabled === 'boolean' ? v.enabled : cur.enabled, weight: int(v.weight, 0, 100) ?? cur.weight, cap: int(v.cap, 0, 100) ?? cur.cap, enforce: typeof v.enforce === 'boolean' ? v.enforce : cur.enforce };
    }
  }
  if (isObj(payload.actions)) {
    for (const s of FRAUD_SURFACES) {
      const v = payload.actions[s]; if (!isObj(v)) continue;
      const next: SurfaceActions = { ...out.actions[s] };
      for (const band of ['REVIEW', 'HOLD'] as const) { const a = v[band]; if (typeof a === 'string' && ALLOWED_ACTIONS[s].includes(a as FraudAction)) next[band] = a as FraudAction; }
      out.actions[s] = next;
    }
  }
  if (isObj(payload.thresholds)) for (const k of Object.keys(out.thresholds) as (keyof FraudThresholds)[]) out.thresholds[k] = int(payload.thresholds[k], 1, 100_000) ?? out.thresholds[k];
  return out;
}

/** A rule is enforced only when the master switch AND its own switch are on. */
export const ruleEnforced = (cfg: FraudRulesConfig, id: FraudRuleId): boolean => cfg.enforce && cfg.rules[id].enabled && cfg.rules[id].enforce;
