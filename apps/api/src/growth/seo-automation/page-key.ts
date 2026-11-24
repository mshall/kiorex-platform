/**
 * Locale-neutral page keys of the public site. `pageKeyOf(type, params)` for a route and `restOfKey(key)` back to the path after /{locale}/{cc}. Entity pages (doctor, nurse, clinic, pharmacy, lab) are
 * keyed by slug, listing pages by their facet parameters, the home page by an empty rest.
 */
const ENTITY = ['doctor', 'nurse', 'clinic', 'pharmacy', 'lab'];
const LISTING_SEG: Record<string, (p: string[]) => string> = {
  hub: (p) => `doctors/${p[0]}`, city: (p) => `doctors/${p[0]}/${p[1]}`, district: (p) => `doctors/${p[0]}/${p[1]}/${p[2]}`, 'care-district': (p) => `${p[0]}/${p[1]}/${p[2]}`,
  'city-hub': (p) => `locations/${p[0]}`, 'district-hub': (p) => `locations/${p[0]}/${p[1]}`, 'same-day': (p) => `same-day/${p[0]}`, telemedicine: (p) => `telemedicine/${p[0]}`,
};
const ORDER: Record<string, string[]> = {
  hub: ['specialty'], city: ['specialty', 'city'], district: ['specialty', 'city', 'district'], 'care-district': ['care', 'city', 'district'], 'city-hub': ['city'], 'district-hub': ['city', 'district'], 'same-day': ['specialty'], telemedicine: ['specialty'],
};

export const isEntityType = (t: string): boolean => ENTITY.includes(t);

export function pageKeyOf(type: string, params: Record<string, string>): string {
  if (type === 'home') return 'home:';
  if (ENTITY.includes(type)) return `${type}:${params.slug ?? ''}`;
  const order = ORDER[type]; if (!order) return `${type}:`;
  return `${type}:${order.map((k) => params[k] ?? '').join('/')}`;
}
export function restOfKey(key: string): string {
  const i = key.indexOf(':'); const type = key.slice(0, i); const rest = key.slice(i + 1);
  if (type === 'home') return '';
  if (ENTITY.includes(type)) return `${type}/${rest}`;
  return LISTING_SEG[type]?.(rest.split('/')) ?? '';
}
export const pathOfKey = (locale: string, cc: string, key: string): string => { const r = restOfKey(key); return `/${locale}/${cc.toLowerCase()}${r ? `/${r}` : ''}`; };
