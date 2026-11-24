/**
 * Cross-device joining for path building (GRW-P3-B). The ONLY join keys are `sub` (the Passport subject recorded on a touch when the visitor signed in) and
 * `visitorKey` (the consent-gated first-party key). A deferred app install joins through the existing claim code, which already writes `sub` on its touch, so it needs no
 * extra key here. There is no device or browser fingerprint, no IP, no probabilistic matching and no third-party identity graph: `assertJoinKey` refuses anything else.
 * PURE.
 */
export const JOIN_KEYS = ['sub', 'visitorKey'] as const;
export type JoinKey = (typeof JOIN_KEYS)[number];
export function assertJoinKey(k: string): asserts k is JoinKey {
  if (!(JOIN_KEYS as readonly string[]).includes(k)) throw new RangeError(`join key '${k}' is not allowed: paths join on sub or visitorKey only`);
}

export interface IdentityTouch { id: string; sub: string | null; visitorKey: string | null }

/**
 * Union of identities through the links that were already recorded: a touch carrying BOTH a sub and a visitorKey links that visitorKey to that sub. Returns a function that
 * maps a touch to its person key (`s:<sub>` when its sub or its visitorKey's linked sub is known, else `v:<visitorKey>`). A visitorKey linked to two different subs (a shared
 * browser) is treated as ambiguous and NOT joined to either: the touch stays on its own `v:` identity, so one person's path never leaks into another's.
 */
export function buildIdentityResolver(touches: readonly IdentityTouch[]): (t: IdentityTouch) => string | null {
  const linked = new Map<string, Set<string>>();
  for (const t of touches) if (t.sub && t.visitorKey) { let s = linked.get(t.visitorKey); if (!s) linked.set(t.visitorKey, (s = new Set())); s.add(t.sub); }
  return (t) => {
    if (t.sub) return `s:${t.sub}`;
    if (t.visitorKey) { const s = linked.get(t.visitorKey); return s && s.size === 1 ? `s:${[...s][0]}` : `v:${t.visitorKey}`; }
    return null;
  };
}
