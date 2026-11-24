/**
 * Experiments on the public web (GRW-P3-A). Framework-free so the SPA, the SSR client entry and tests share it.
 *
 * Rules (ARCH 6.2, AD-8): nothing is requested, stored or sent without analytics consent: with no consent every caller gets the CONTROL and no network call is made. The server recomputes the variant from
 * the consented visitor key; this module never invents or remembers a variant of its own beyond a 10-minute in-memory cache. Safety, consent, price and clinical surfaces are not experiment surfaces
 * (the server refuses them): a component never needs a guard for that, but it must never branch on a variant for those texts. A failed call is the control.
 */
import { consentHeaders, readConsent } from "./consent";

export interface ExperimentAssignment { experiment: string; surface: string; variant: string; flagKey: string | null }
export const EXPERIMENTS_PATH = "/api/v1/growth/v1/experiments";
export const CONTROL = "control";
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; list: ExperimentAssignment[] }>();
const exposed = new Set<string>();

export interface ExperimentDeps { fetch: typeof fetch; now: () => number; consent: () => boolean }
const browser = (): ExperimentDeps => ({ fetch: (...a) => fetch(...a), now: () => Date.now(), consent: () => readConsent()?.analytics === true });

/** The visitor's assignments for a surface (empty = everything is control). No consent means no request at all. */
export async function loadAssignments(surface: string, locale?: string, d: ExperimentDeps = browser()): Promise<ExperimentAssignment[]> {
  if (!d.consent()) return [];
  const key = `${surface}|${locale ?? ""}`; const hit = cache.get(key);
  if (hit && d.now() - hit.at < TTL_MS) return hit.list;
  try {
    const q = new URLSearchParams({ surface, platform: "web", ...(locale ? { locale } : {}) });
    const r = await d.fetch(`${EXPERIMENTS_PATH}/assignments?${q.toString()}`, { headers: { ...consentHeaders() }, credentials: "same-origin" });
    if (!r.ok) return [];
    const j = (await r.json()) as { assignments?: ExperimentAssignment[] };
    const list = Array.isArray(j.assignments) ? j.assignments.filter((a) => typeof a?.experiment === "string" && typeof a?.variant === "string") : [];
    cache.set(key, { at: d.now(), list }); return list;
  } catch { return []; }
}

/** The variant to render for an experiment key: the assignment, otherwise control. */
export const variantOf = (list: readonly ExperimentAssignment[], experiment: string): string => list.find((a) => a.experiment === experiment)?.variant ?? CONTROL;

/** Tells the server the visitor SAW the variant (once per page session per experiment; consent required; never throws). */
export async function recordExposure(experiment: string, d: ExperimentDeps = browser()): Promise<boolean> {
  if (!d.consent() || exposed.has(experiment)) return false;
  exposed.add(experiment);
  try { const r = await d.fetch(`${EXPERIMENTS_PATH}/exposures`, { method: "POST", headers: { "content-type": "application/json", ...consentHeaders() }, body: JSON.stringify({ experiment }), credentials: "same-origin" }); return r.ok; } catch { return false; }
}

export const resetExperimentCache = () => { cache.clear(); exposed.clear(); };
