/**
 * postMessage protocol between the SDK (embedding page) and the widget (iframe). Shared by both sides, so it stays tiny and dependency free.
 *
 * Rules (ADR-044): every message is a plain object `{ kx: 1, type, ... }`; the receiver checks BOTH `event.origin` (exact string equality with the one origin it expects)
 * and `event.source` (the exact window), then validates the message with `parseToParent` / `parseToWidget`; unknown types, extra shapes, wrong types and oversized values
 * are dropped silently. Senders always pass an exact `targetOrigin` (never `*`). Messages carry NO personal data: `kx:booked` holds a status and an opaque booking reference.
 */
export const PROTOCOL = 1;

export type ToParent =
  | { kx: 1; type: 'kx:ready' }
  | { kx: 1; type: 'kx:resize'; height: number }
  | { kx: 1; type: 'kx:booked'; status: string; bookingRef: string }
  | { kx: 1; type: 'kx:error'; code: string };

export type ToWidget = { kx: 1; type: 'kx:init'; lt?: string; ref?: string; locale?: 'ar' | 'en' };

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const TOKEN = /^[A-Za-z0-9._~-]{1,512}$/;
const CODE = /^[A-Z0-9_]{1,64}$/;
const REF = /^[A-Za-z0-9_-]{1,80}$/;

export function parseToParent(d: unknown): ToParent | null {
  if (!obj(d) || d.kx !== 1) return null;
  switch (d.type) {
    case 'kx:ready': return { kx: 1, type: 'kx:ready' };
    case 'kx:resize': return typeof d.height === 'number' && Number.isFinite(d.height) && d.height >= 0 && d.height <= 20000 ? { kx: 1, type: 'kx:resize', height: Math.ceil(d.height) } : null;
    case 'kx:booked': return str(d.status, 32) && CODE.test(d.status) && str(d.bookingRef, 80) && REF.test(d.bookingRef) ? { kx: 1, type: 'kx:booked', status: d.status, bookingRef: d.bookingRef } : null;
    case 'kx:error': return str(d.code, 64) && CODE.test(d.code) ? { kx: 1, type: 'kx:error', code: d.code } : null;
    default: return null;
  }
}

export function parseToWidget(d: unknown): ToWidget | null {
  if (!obj(d) || d.kx !== 1 || d.type !== 'kx:init') return null;
  const out: ToWidget = { kx: 1, type: 'kx:init' };
  if (d.lt !== undefined) { if (!str(d.lt, 512) || !TOKEN.test(d.lt)) return null; out.lt = d.lt; }
  if (d.ref !== undefined) { if (!str(d.ref, 80) || !REF.test(d.ref)) return null; out.ref = d.ref; }
  if (d.locale !== undefined) { if (d.locale !== 'ar' && d.locale !== 'en') return null; out.locale = d.locale; }
  return out;
}

/** The single acceptance test for a received message: right sender window, exact origin. Returns the raw data to validate, or undefined. */
export function acceptFrom(e: { origin: string; source: unknown; data: unknown }, expectedOrigin: string | null, expectedSource: unknown): unknown {
  if (!expectedOrigin || e.origin !== expectedOrigin) return undefined;
  if (!expectedSource || e.source !== expectedSource) return undefined;
  return e.data;
}
