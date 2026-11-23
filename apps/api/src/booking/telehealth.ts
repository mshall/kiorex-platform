/**
 * Kiorex side of Clinic-owned telehealth (P2P WebRTC, TELEHEALTH_PLAN.md flow A). The Clinic owns the TelehealthSession and issues the patient
 * join link; Kiorex only stores what the confirmation / event carries and shows "Join video visit". No media, no tokens minted here.
 *
 * Shape (plan section 4, Flow A): booking confirmation and event `data.telehealth = { sessionId, joinUrl, opensAt?, closesAt? }`, where
 * joinUrl = `<clinic public web>/v/<token>`. `telehealth: null` (or serviceLocation moving back to IN_CLINIC) means "changed to in-person".
 * The contract schemas are not published yet: every field is read defensively and unknown events are ignored.
 */
export type TeleState = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'MISSED' | 'CANCELLED' | 'IN_PERSON';

export interface TeleBlock { sessionId: string; joinUrl: string | null; opensAt: string | null; closesAt: string | null; state: TeleState; movedFrom: string | null }

export const TELE_OPEN_BEFORE_MS = 15 * 60_000;
export const TELE_CLOSE_AFTER_MS = 2 * 3600_000;

const iso = (v: unknown): string | null => { const d = typeof v === 'string' || typeof v === 'number' || v instanceof Date ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };

/** Only http(s) URLs are accepted (opened in a browser / WebView). Anything else is dropped, never rendered. */
export const safeJoinUrl = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 2048) return null;
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null; } catch { return null; }
};

/** Parse `data.telehealth`. Returns null when absent or unusable. `joinUrl` also accepted as `patientJoinUrl`. */
export function parseTelehealth(raw: unknown, prev?: TeleBlock | null): TeleBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sessionId = typeof r.sessionId === 'string' && r.sessionId ? r.sessionId : prev?.sessionId;
  if (!sessionId) return null;
  const joinUrl = safeJoinUrl(r.joinUrl ?? r.patientJoinUrl) ?? prev?.joinUrl ?? null;
  return { sessionId, joinUrl, opensAt: iso(r.opensAt) ?? null, closesAt: iso(r.closesAt) ?? null, state: prev?.state ?? 'SCHEDULED', movedFrom: prev?.movedFrom ?? null };
}

/** Window shown to the patient: the Clinic's server-computed one when given, else derived from the booking time. */
export const teleWindow = (b: TeleBlock, startsAt: Date) => ({
  opensAt: b.opensAt ?? new Date(startsAt.getTime() - TELE_OPEN_BEFORE_MS).toISOString(),
  closesAt: b.closesAt ?? new Date(startsAt.getTime() + TELE_CLOSE_AFTER_MS).toISOString(),
});

/** Public (patient) view: state folds in the booking status; the join URL is withheld once the visit can no longer be joined. */
export function presentTelehealth(block: TeleBlock | null, booking: { status: string; startsAt: Date }) {
  if (!block) return null;
  let state: TeleState = block.state;
  if (state !== 'IN_PERSON') {
    if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') state = 'CANCELLED';
    else if (booking.status === 'NO_SHOW') state = 'MISSED';
    else if (booking.status === 'COMPLETED') state = 'ENDED';
  }
  const w = teleWindow(block, booking.startsAt);
  const joinable = (state === 'SCHEDULED' || state === 'LIVE') && !!block.joinUrl;
  return { sessionId: block.sessionId, state, joinUrl: joinable ? block.joinUrl : null, opensAt: w.opensAt, closesAt: w.closesAt, movedFrom: state === 'SCHEDULED' || state === 'LIVE' ? block.movedFrom : null };
}

/** Clinic `telehealth.session.*` event types Kiorex understands; everything else under the prefix is ignored (forward compatible). */
export const TELE_EVENT_STATE: Record<string, TeleState | 'LINK' | 'WINDOW'> = {
  'telehealth.session.created': 'SCHEDULED',
  'telehealth.session.link_regenerated': 'LINK',
  'telehealth.session.rescheduled': 'WINDOW',
  'telehealth.session.started': 'LIVE',
  'telehealth.session.ended': 'ENDED',
  'telehealth.session.missed': 'MISSED',
  'telehealth.session.cancelled': 'CANCELLED',
  'telehealth.session.converted': 'IN_PERSON',
};
export const isTelehealthEvent = (type: string) => type.toLowerCase().startsWith('telehealth.');
