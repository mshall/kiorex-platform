import { FLAGS } from '@kiorex/contracts';

/**
 * Growth capability switches (ADR-023/024/025). The catalogue itself lives in control-plane/flag-catalogue.ts (and in @kiorex/contracts 1.10.0);
 * this file only names the keys the growth family guards, so services import constants instead of string literals.
 * Safety is never a flag: nothing here gates emergency routing, safety alerts or clinical messages.
 */
export const GROWTH_FLAG = {
  PROVIDER_LINKS: FLAGS.GROWTH_PROVIDER_LINKS,
  ATTRIBUTION: FLAGS.GROWTH_ATTRIBUTION,
  SSR_PUBLIC_PAGES: FLAGS.GROWTH_SSR_PUBLIC_PAGES,
  SEO_LANDING_PAGES: FLAGS.GROWTH_SEO_LANDING_PAGES,
  WIDGETS: FLAGS.GROWTH_WIDGETS,
  DEEP_LINKS: FLAGS.GROWTH_DEEP_LINKS,
  ANALYTICS_VISITOR: FLAGS.GROWTH_ANALYTICS_VISITOR,
  MARKETING_MESSAGING: FLAGS.GROWTH_MARKETING_MESSAGING,
  CAMPAIGNS: FLAGS.GROWTH_CAMPAIGNS,
  PATIENT_REFERRAL: FLAGS.GROWTH_PATIENT_REFERRAL,
  REWARDS: FLAGS.GROWTH_REWARDS,
  WHATSAPP_AI_ASSISTANT: FLAGS.KIOREX_WHATSAPP_AI_ASSISTANT,
  EXPERIMENTS: FLAGS.GROWTH_EXPERIMENTS,
} as const;
export type GrowthFlagKey = (typeof GROWTH_FLAG)[keyof typeof GROWTH_FLAG];

/** Flags that are launch-locked (effective only with human-recorded gate evidence, ADR-024). */
export const GROWTH_LAUNCH_LOCKED_FLAGS: readonly GrowthFlagKey[] = [
  GROWTH_FLAG.ANALYTICS_VISITOR, GROWTH_FLAG.MARKETING_MESSAGING, GROWTH_FLAG.PATIENT_REFERRAL, GROWTH_FLAG.REWARDS, GROWTH_FLAG.WHATSAPP_AI_ASSISTANT,
];

/** Every growth table carries a market code; one live market today (EG). Code never branches on it: it is a column default and a config scope id. */
export const GROWTH_DEFAULT_MARKET = 'EG';
