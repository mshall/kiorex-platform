/**
 * Anchors (GRW-P2-E). `LifecycleEnrollment` is unique on (sub, journeyKey, journeyVersion) and has no column for what the journey is about, so an anchored journey stores its
 * anchor INSIDE the journey key: `<key>#<id>.<base64url JSON of {at, p}>`. Re-enrolling the same anchor produces the same key, which is the idempotency of (sub, journey, anchor).
 * The anchor carries ids and a few allowlisted parameters, never a clinical value. PURE.
 */
export interface Anchor { id: string; at: number; params: Record<string, unknown> }
const ID = /^[A-Za-z0-9_:.-]{1,80}$/;

export function encodeAnchor(key: string, a: Anchor): string {
  if (!ID.test(a.id)) throw new Error('invalid anchor id');
  const rest = Buffer.from(JSON.stringify({ at: a.at, p: a.params })).toString('base64url');
  return `${key}#${a.id}.${rest}`;
}
export function decodeAnchor(journeyKey: string): { key: string; anchor: Anchor | null } {
  const i = journeyKey.indexOf('#');
  if (i < 0) return { key: journeyKey, anchor: null };
  const key = journeyKey.slice(0, i); const tail = journeyKey.slice(i + 1); const dot = tail.lastIndexOf('.');
  try {
    const id = tail.slice(0, dot); const r = JSON.parse(Buffer.from(tail.slice(dot + 1), 'base64url').toString('utf8')) as { at: number; p: Record<string, unknown> };
    return { key, anchor: { id, at: Number(r.at), params: r.p ?? {} } };
  } catch { return { key, anchor: null }; }
}
/** The prefix every enrolment of one anchor id shares (to find an earlier enrolment whose parameters differ). */
export const anchorPrefix = (key: string, id: string) => `${key}#${id}.`;
