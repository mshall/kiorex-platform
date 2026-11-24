import { createHash } from 'node:crypto';
import { buildIdentityResolver } from './identity-link';
import type { PathTouch } from './models';
import { inWindow, maxWindowDays, type ModelWindows, DEFAULT_WINDOWS } from './windows';

/** A stored touch, reduced to the fields a path needs. No IP, no UA, no click id: nothing here identifies a person beyond the two allowed join keys. */
export interface RawTouch { id: string; sub: string | null; visitorKey: string | null; at: number; kind: string; ref: string; campaignId: string }
export interface ConversionFact { id: string; /** the booking's Passport sub (join key `sub`) */ sub: string | null; at: number; revenueMinor: number }
export interface ConvertingPath { conversionId: string; at: number; revenueMinor: number; touches: PathTouch[] }
export interface NonConvertingPath { kinds: string[] }

export const MAX_PATH_TOUCHES = 50;
/** Keeps the first touch and the last N-1 (first and last matter to the position model); never reorders. */
export const capPath = <T>(p: readonly T[], max = MAX_PATH_TOUCHES): T[] => (p.length <= max ? [...p] : [p[0]!, ...p.slice(p.length - (max - 1))]);

/** Hash of the ordered source KINDS of a path (no refs, ids or times): the only thing a path snapshot stores. */
export const pathHashOf = (kinds: readonly string[]) => createHash('sha256').update(kinds.join('>')).digest('hex').slice(0, 16);

/**
 * Builds the converting and non-converting paths. Joins touches to a person only through `identity-link` (sub, visitorKey); a conversion is joined by the booking's `sub`.
 * Per person the touches are ordered by (time, id); a touch before an earlier conversion of the same person is not reused for a later one; each touch must be inside its
 * own look-back window (market day arithmetic) of the conversion and not after it. A conversion with no touch gets an empty path (the caller credits UNATTRIBUTED).
 * Persons with touches and no conversion in the data become non-converting paths (used only by the data-driven model).
 */
export function buildPaths(touches: readonly RawTouch[], conversions: readonly ConversionFact[], zone: string, windows: ModelWindows = DEFAULT_WINDOWS): { converting: ConvertingPath[]; nonConverting: NonConvertingPath[] } {
  const resolve = buildIdentityResolver(touches);
  const byPerson = new Map<string, RawTouch[]>();
  for (const t of touches) { const k = resolve(t); if (!k) continue; let a = byPerson.get(k); if (!a) byPerson.set(k, (a = [])); a.push(t); }
  for (const a of byPerson.values()) a.sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
  const convByPerson = new Map<string, ConversionFact[]>(); const loose: ConversionFact[] = [];
  for (const c of conversions) { if (!c.sub) { loose.push(c); continue; } const k = `s:${c.sub}`; let a = convByPerson.get(k); if (!a) convByPerson.set(k, (a = [])); a.push(c); }
  const converting: ConvertingPath[] = [];
  for (const [person, convs] of convByPerson) {
    convs.sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
    const ts = byPerson.get(person) ?? []; let floor = -Infinity;
    for (const c of convs) {
      const path = ts.filter((t) => t.at > floor && inWindow(t, c.at, zone, windows)).map((t): PathTouch => ({ at: t.at, kind: t.kind, ref: t.ref, campaignId: t.campaignId }));
      converting.push({ conversionId: c.id, at: c.at, revenueMinor: c.revenueMinor, touches: capPath(path) });
      floor = c.at;
    }
  }
  for (const c of loose) converting.push({ conversionId: c.id, at: c.at, revenueMinor: c.revenueMinor, touches: [] });
  converting.sort((a, b) => a.at - b.at || (a.conversionId < b.conversionId ? -1 : 1));
  const nonConverting: NonConvertingPath[] = [];
  const horizon = maxWindowDays(windows) * 86_400_000;
  for (const [person, ts] of byPerson) {
    if (convByPerson.has(person)) {
      // touches after the person's last conversion form a (not yet converted) path as well
      const last = convByPerson.get(person)!.at(-1)!.at; const rest = ts.filter((t) => t.at > last);
      if (rest.length) nonConverting.push({ kinds: capPath(rest).map((t) => t.kind) });
      continue;
    }
    const newest = ts[ts.length - 1]!.at; const recent = ts.filter((t) => newest - t.at <= horizon);
    if (recent.length) nonConverting.push({ kinds: capPath(recent).map((t) => t.kind) });
  }
  return { converting, nonConverting };
}
