import { clamp01, type FraudRuleDef } from '../signals';

/** Widget abuse: origin forgery (requests whose Origin does not match the registered origins), one key from many origins, a request flood from one origin, token replays. */
export const rWidgetAbuse: FraudRuleDef = {
  id: 'r_widget_abuse', kind: 'WIDGET', surfaces: ['WIDGET'],
  evaluate(f, t) {
    const parts: { s: number; why: string; ev: string }[] = [];
    if ((f.widgetOriginMismatches ?? 0) >= t.widgetOriginMismatches) parts.push({ s: clamp01(0.8 + (f.widgetOriginMismatches! - t.widgetOriginMismatches) * 0.03), why: 'origin forgery', ev: 'origin-mismatch' });
    if ((f.widgetDistinctOriginsPerKey1h ?? 0) >= t.widgetDistinctOriginsPerKey1h) parts.push({ s: 0.8, why: 'one widget key used from many origins', ev: 'many-origins-per-key' });
    if ((f.widgetRequestsPerOrigin5m ?? 0) >= t.widgetRequestsPerOrigin5m) parts.push({ s: 0.6, why: 'request flood from one origin', ev: 'request-flood' });
    if ((f.widgetTokenReplays ?? 0) >= t.widgetTokenReplays) parts.push({ s: 0.75, why: 'widget token replay', ev: 'token-replay' });
    if (!parts.length) return null;
    const top = parts.reduce((a, b) => (b.s > a.s ? b : a));
    return { strength: clamp01(top.s + 0.05 * (parts.length - 1)), reason: top.why, evidence: parts.map((p) => p.ev) };
  },
};
