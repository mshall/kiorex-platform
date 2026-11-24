/** Scheme + host + port of a URL, lower-cased, or null. Never throws. */
export function originOfUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try { const u = new URL(raw); return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin.toLowerCase() : null; } catch { return null; }
}
