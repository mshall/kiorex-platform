// Family visit-status view model (KXMHV07). The API already omits address, fee, phone and reasons; this adapter additionally WHITELISTS fields,
// so even if a future response carried extra data it could never reach the screen.
export interface VisitStep { key: string; reached: boolean; at: string | null }
export interface VisitStatusView { firstName: string; startsAt: string; stopped: boolean; steps: VisitStep[]; etaMinutes: number | null; providerName: string | null }

type Raw = { patientFirstName?: string | null; startsAt: string; stopped?: boolean; steps?: unknown[]; eta?: unknown; provider?: unknown };

export function toVisitView(raw: Raw): VisitStatusView {
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).flatMap((s) => {
    const o = s as { key?: unknown; reached?: unknown; at?: unknown };
    return typeof o?.key === "string" ? [{ key: o.key, reached: o.reached === true, at: typeof o.at === "string" ? o.at : null }] : [];
  });
  const eta = (raw.eta ?? {}) as { minutes?: unknown; shared?: unknown };
  const stopped = raw.stopped === true;
  const etaMinutes = !stopped && eta.shared === true && typeof eta.minutes === "number" ? Math.max(0, Math.round(eta.minutes)) : null;
  const pn = (raw.provider as { displayName?: unknown } | null)?.displayName;
  return { firstName: raw.patientFirstName ?? "", startsAt: raw.startsAt, stopped, steps, etaMinutes, providerName: !stopped && typeof pn === "string" && pn ? pn : null };
}

/** Token shape guard for deep links (url-safe, bounded). */
export const isValidToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(t);
