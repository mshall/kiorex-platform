import { validateStep, STEPS, type StepId } from './onboarding-steps';

/**
 * Market readiness checklist (GRW-P3-G). PURE: facts in, one list out. A row is DONE, TODO (engineering or ops can do it in the console), AWAITING_CHECKER (a config version waits for the second
 * super admin) or NEEDS_HUMAN (counsel, legal, a human gate: the code cannot do it and never records it). `ready` means no TODO or AWAITING_CHECKER is left; it is NOT launch: the live
 * state is only the `market.<cc>.live` gate recorded by a person in the super admin.
 */
export type ReadinessStatus = 'DONE' | 'TODO' | 'AWAITING_CHECKER' | 'NEEDS_HUMAN';
export interface ReadinessFacts {
  steps: Partial<Record<string, Record<string, unknown>>>;
  geography: { cities: number; districts: number };
  versions: Partial<Record<'MARKET_PROFILE' | 'MARKET_GROWTH' | 'CONSENT_DEFAULTS', 'NONE' | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE'>>;
  flagDefined: boolean; live: boolean;
  /** Other markets bound to the same data cell (informational: one cell today means every market is "same cell"). */
  sameCellMarkets: string[];
}
export interface ReadinessItem { id: string; status: ReadinessStatus; detail: string; humanOwner?: string }

const PLACEHOLDER = /^TODO_NEEDS_HUMAN/;
export function readiness(f: ReadinessFacts): { items: ReadinessItem[]; ready: boolean; live: boolean; todo: number; needsHuman: number } {
  const items: ReadinessItem[] = [];
  const step = (id: StepId, label: string) => {
    const p = f.steps[id];
    if (id === 'geography') { items.push({ id, status: f.geography.cities > 0 ? 'DONE' : 'TODO', detail: `${f.geography.cities} cities, ${f.geography.districts} districts` }); return; }
    if (!p) { items.push({ id, status: 'TODO', detail: `${label} not answered yet` }); return; }
    const errs = validateStep(id, p); items.push({ id, status: errs.length ? 'TODO' : 'DONE', detail: errs[0] ?? label });
  };
  for (const s of STEPS) step(s, s);
  const reg = f.steps.regulation as { marketingLicenceRequired?: boolean; marketingLicenceHeld?: boolean } | undefined;
  items.push({ id: 'marketingLicence', status: reg?.marketingLicenceRequired === false || reg?.marketingLicenceHeld === true ? 'DONE' : 'NEEDS_HUMAN', detail: 'Direct-marketing licence position; growth.marketing_messaging stays launch-locked either way', humanOwner: 'counsel' });
  const t = (f.steps.consent?.textVersionIds ?? {}) as Record<string, string>;
  items.push({ id: 'consentTexts', status: t.analytics && t.marketing && !PLACEHOLDER.test(t.analytics) && !PLACEHOLDER.test(t.marketing) ? 'DONE' : 'NEEDS_HUMAN', detail: 'Approved consent wording ids per language (the wording itself is written by counsel)', humanOwner: 'counsel' });
  items.push({ id: 'legalTexts', status: 'NEEDS_HUMAN', detail: 'Privacy notice, terms, health-advertising wording and data-export rules for the market', humanOwner: 'counsel' });
  const cfg = (['MARKET_PROFILE', 'MARKET_GROWTH', 'CONSENT_DEFAULTS'] as const).map((k) => f.versions[k] ?? 'NONE');
  items.push({ id: 'configVersions', status: cfg.every((v) => v === 'ACTIVE') ? 'DONE' : cfg.some((v) => v === 'PENDING_APPROVAL' || v === 'APPROVED') ? 'AWAITING_CHECKER' : 'TODO', detail: `MARKET_PROFILE ${cfg[0]}, MARKET_GROWTH ${cfg[1]}, CONSENT_DEFAULTS ${cfg[2]}` });
  items.push({ id: 'flagDefinition', status: f.flagDefined ? 'DONE' : 'TODO', detail: 'The market.<cc>.live flag exists (launch-locked, OFF)' });
  items.push({ id: 'launchGate', status: f.live ? 'DONE' : 'NEEDS_HUMAN', detail: 'Market pack certification and local counsel; recorded by a person in the super admin, never by code', humanOwner: 'founder' });
  const todo = items.filter((i) => i.status === 'TODO' || i.status === 'AWAITING_CHECKER').length;
  return { items, ready: todo === 0, live: f.live, todo, needsHuman: items.filter((i) => i.status === 'NEEDS_HUMAN').length };
}
