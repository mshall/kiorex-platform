/**
 * District codes (Rev 2.3, KX-09 §03): lowercase slugs such as `nasr-city`. District is the ONLY location granularity allowed in coverage
 * checks, analytics and logs; free text (an address line) never validates as a district.
 */
export function normalizeDistrict(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().replace(/[\s_]+/g, '-');
  return /^[a-z0-9][a-z0-9-]{1,39}$/.test(s) ? s : null;
}

/** What may appear in a log line, an audit row or an analytics event for a visit address: district level only, never the street/building/pin. */
export function addressForLog(a: { district?: string | null; governorate?: string | null } | null | undefined): { district: string | null; governorate: string | null; address: '[masked]' } {
  return { district: a?.district ?? null, governorate: a?.governorate ?? null, address: '[masked]' };
}
