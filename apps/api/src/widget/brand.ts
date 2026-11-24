/**
 * Branding customisation within safe bounds (GRW-P1-G). Providers may set a brand colour, a corner radius and show or hide their own logo. Everything else is fixed
 * by Kiorex so the widget stays accessible (WCAG AA) whatever a site owner chooses:
 *   - colour: `#rrggbb` only; text on it is white or ink, whichever reaches 4.5:1 (a mid-tone fill is darkened until one does); when the colour itself is too light to be used as text or a focus ring on white
 *     it is darkened step by step until it reaches 4.5:1 (the derived `accentText`).
 *   - radius: integer 0..16 px (default 10).
 *   - logo: never a URL from the page: only the logo the clinic already published to Kiorex (https), shown when `logo` is not switched off.
 * Pure functions; the same maths runs in the widget app (src/lib/contrast.ts is a copy kept in sync by a unit test).
 */
export interface Brand { accent: string; onAccent: string; accentText: string; radius: number; logo: boolean }
export const DEFAULT_ACCENT = '#3730a3'; // Kiorex indigo (brand tokens)
export const DEFAULT_RADIUS = 10;
export const MAX_RADIUS = 16;

const HEX = /^#[0-9a-f]{6}$/;
export function parseHexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  const full = /^[0-9a-f]{6}$/.test(s) ? `#${s}` : s;
  return HEX.test(full) ? full : null;
}
const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
function darken(hex: string, f: number): string { const n = parseInt(hex.slice(1), 16); return toHex(((n >> 16) & 255) * f, ((n >> 8) & 255) * f, (n & 255) * f); }

export function resolveBrand(input: { color?: unknown; radius?: unknown; logo?: unknown }): Brand {
  let accent = parseHexColor(input.color) ?? DEFAULT_ACCENT;
  // mid-tone colours reach 4.5:1 with neither white nor ink text: darken the FILL until white text does (the accent is adjusted, never the text contrast)
  let fit = 0;
  while (Math.max(contrast('#ffffff', accent), contrast('#0f172a', accent)) < 4.5 && fit++ < 40) accent = darken(accent, 0.94);
  const r = Number(input.radius);
  const radius = Number.isInteger(r) && r >= 0 && r <= MAX_RADIUS ? r : DEFAULT_RADIUS;
  const onAccent = contrast('#ffffff', accent) >= contrast('#0f172a', accent) ? '#ffffff' : '#0f172a';
  let accentText = accent; let guard = 0;
  while (contrast(accentText, '#ffffff') < 4.5 && guard++ < 40) accentText = darken(accentText, 0.92);
  return { accent, onAccent, accentText, radius, logo: !(input.logo === 'off' || input.logo === false || input.logo === '0') };
}
