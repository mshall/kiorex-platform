import { policyNow } from '../policy/policy-registry';
import { ApiError } from '../../common/errors';

/**
 * Never-experiment rule (AD-8, ADR-025). A CLOSED allowlist of surfaces an experiment may sit on, plus the denylist it is checked against twice (tags and name tokens).
 * Adding a surface is a code change reviewed against `safety-never-flags.json` (a unit test enumerates that file and fails when a registry entry intersects it); there is no flag, no config
 * and no API that widens the list. Emergency guidance, triage and the symptom checker, safety copy, privacy and consent screens, regulatory text, clinical content, price or fee disclosure,
 * cancellation policy text, money, commission and attribution policy are never here. The database repeats the name rule as a CHECK (GrowthExperiment_surface_never_check).
 */
export interface SurfaceDef { key: string; label: string; tags: readonly string[]; /** which units can see it */ units: readonly ('VISITOR' | 'SUB')[]; ssr: boolean; platforms: readonly ('web' | 'ios' | 'android')[] }

export const SURFACES: readonly SurfaceDef[] = [
  { key: 'landing.home.hero_copy', label: 'Home page hero headline and sub-line', tags: ['marketing-copy'], units: ['VISITOR', 'SUB'], ssr: true, platforms: ['web'] },
  { key: 'landing.provider.cta_label', label: 'Provider page booking button label', tags: ['marketing-copy', 'cta'], units: ['VISITOR', 'SUB'], ssr: true, platforms: ['web'] },
  { key: 'landing.search.empty_state', label: 'Search no-results suggestion copy', tags: ['marketing-copy'], units: ['VISITOR', 'SUB'], ssr: true, platforms: ['web'] },
  { key: 'signup.value_proposition', label: 'Sign-up page value proposition', tags: ['marketing-copy'], units: ['VISITOR', 'SUB'], ssr: false, platforms: ['web', 'ios', 'android'] },
  { key: 'app.home.tile_order', label: 'App home tile order (non-clinical tiles)', tags: ['layout'], units: ['SUB'], ssr: false, platforms: ['ios', 'android'] },
  { key: 'referral.invite_prompt', label: 'Referral invite prompt wording', tags: ['marketing-copy'], units: ['SUB'], ssr: false, platforms: ['web', 'ios', 'android'] },
  { key: 'booking.post_booking.share_prompt', label: 'Share prompt after a confirmed booking', tags: ['marketing-copy'], units: ['SUB'], ssr: false, platforms: ['web', 'ios', 'android'] },
  { key: 'lifecycle.winback.subject_line', label: 'Win-back message subject line (marketing purpose only)', tags: ['marketing-copy', 'messaging'], units: ['SUB'], ssr: false, platforms: ['web'] },
];
export const surfaceByKey = (k: string) => SURFACES.find((s) => s.key === k);

/** Tags a surface may never carry, and name fragments no surface or flag key may contain. */
export const DENY_TAGS: readonly string[] = ['emergency', 'triage', 'symptom-checker', 'safety-copy', 'privacy', 'consent', 'regulatory', 'clinical', 'price-disclosure', 'fee-disclosure', 'cancellation-policy', 'payment', 'commission', 'attribution-policy', 'credit', 'reward-rules'];
export const DENY_NAME_TOKENS: readonly string[] = [
  'emergency', 'triage', 'symptom', 'safety', 'consent', 'privacy', 'regulat', 'clinical', 'diagnos', 'prescri', 'pricing', 'price', 'cancel', 'refund', 'payment', 'deposit', 'commission', 'attribution',
];

/** Name tokens from the shared safety file (injected by the caller so the unit test can load the real `safety-never-flags.json`). */
export function nameHitsDenylist(name: string, extraTokens: readonly string[] = []): string | null {
  const n = name.toLowerCase();
  for (const t of [...DENY_NAME_TOKENS, ...extraTokens]) if (t && n.includes(t.toLowerCase())) return t;
  // short words only as whole path segments, so "feedback" is not "fee"
  if (/(^|[._-])(fees?|credits?|rewards?|sos|mfa|audit|recall)([._-]|$)/.test(n)) return 'fee|credit|reward|sos|mfa|audit|recall';
  return null;
}

export const forbidden = (surface: string, why: string) => new ApiError(422, 'EXPERIMENT_SURFACE_FORBIDDEN', `Surface "${surface}" cannot host an experiment: ${why}`, { surface });

/** Throws 422 EXPERIMENT_SURFACE_FORBIDDEN unless the surface is on the allowlist and nothing about it hits the denylist. `tags` lets a caller pass extra claimed tags (always checked). */
export function assertSurfaceAllowed(surface: string, tags: readonly string[] = [], extraTokens: readonly string[] = []): SurfaceDef {
  const hit = nameHitsDenylist(surface, extraTokens);
  if (hit) throw forbidden(surface, `its name matches the never-experiment list (${hit})`);
  const deny = [...DENY_TAGS, ...(policyNow<{ deniedTags?: string[] }>('EXPERIMENT_POLICY').deniedTags ?? [])]; // the stored list can only ADD tags, the code list is never reduced
  const bad = [...tags].find((t) => deny.includes(t.toLowerCase()));
  if (bad) throw forbidden(surface, `tag "${bad}" is on the never-experiment list`);
  const def = surfaceByKey(surface);
  if (!def) throw forbidden(surface, 'it is not on the allowlist of experiment surfaces');
  const own = def.tags.find((t) => DENY_TAGS.includes(t));
  if (own) throw forbidden(surface, `registry tag "${own}" is on the never-experiment list`);
  return def;
}

/** A flag referenced by an experiment may never be a safety, money or launch-locked key. */
export function assertFlagKeyAllowed(flagKey: string, extraTokens: readonly string[] = []): void {
  const hit = nameHitsDenylist(flagKey, extraTokens);
  if (hit || /^(market|pay|kiorex\.pay|growth\.(patient_credit|refund_as_credit|family_credit|support_goodwill|sponsored_promotions|rewards|marketing_messaging|patient_referral))/.test(flagKey)) {
    throw new ApiError(422, 'EXPERIMENT_FLAG_FORBIDDEN', `Flag "${flagKey}" cannot be linked to an experiment (safety, money or launch-locked key)`, { flagKey });
  }
}
