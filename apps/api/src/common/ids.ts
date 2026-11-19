import { randomBytes } from 'node:crypto';
/** Sortable-ish unique id: <prefix>_<time36><random> */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;
}
export const toMinor = (major: number): number => Math.round(major * 100);
export const toMajor = (minor: number): number => minor / 100;
