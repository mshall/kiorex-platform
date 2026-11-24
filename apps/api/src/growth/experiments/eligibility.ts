import type { Eligibility } from './experiment.types';

export interface EligibilityContext { market: string; locale?: string; platform?: string; stage?: 'new' | 'returning' }

/** PURE. A unit outside the eligibility sees control and is not recorded. Missing context fields never match a rule that names them (fail closed). */
export function isEligible(e: Eligibility | null | undefined, ctx: EligibilityContext): boolean {
  if (!e) return true;
  if (e.markets?.length && !e.markets.includes(ctx.market)) return false;
  if (e.locales?.length && !(ctx.locale && (e.locales as string[]).includes(ctx.locale))) return false;
  if (e.platforms?.length && !(ctx.platform && (e.platforms as string[]).includes(ctx.platform))) return false;
  if (e.stage && ctx.stage !== e.stage) return false;
  return true;
}

export function validateEligibility(e: unknown): string | null {
  if (e === undefined || e === null) return null;
  if (typeof e !== 'object' || Array.isArray(e)) return 'eligibility must be an object';
  const allowed = new Set(['markets', 'locales', 'platforms', 'stage']);
  for (const k of Object.keys(e)) if (!allowed.has(k)) return `eligibility.${k} is not allowed (only markets, locales, platforms, stage: nothing clinical or personal)`;
  const o = e as Record<string, unknown>;
  if (o.markets !== undefined && !(Array.isArray(o.markets) && o.markets.every((m) => typeof m === 'string' && /^[A-Z]{2}$/.test(m)))) return 'eligibility.markets must be ISO country codes';
  if (o.locales !== undefined && !(Array.isArray(o.locales) && o.locales.every((m) => m === 'ar' || m === 'en'))) return 'eligibility.locales must be ar or en';
  if (o.platforms !== undefined && !(Array.isArray(o.platforms) && o.platforms.every((m) => m === 'web' || m === 'ios' || m === 'android'))) return 'eligibility.platforms must be web, ios or android';
  if (o.stage !== undefined && o.stage !== 'new' && o.stage !== 'returning') return 'eligibility.stage must be new or returning';
  return null;
}
