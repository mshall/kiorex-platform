import { normalizeArabic } from '../growth/seo/seo-public';
import { SPECIALTY_LABELS } from '../safety/safety-public';
import { slugifyPlace } from './geo';
import { parsePublicPath } from './url-policy';

/**
 * Loose URL resolution (GRW-P1-F, "Arabic search normalization for slug resolution"). A visitor, a link written by hand or a crawler may reach
 * `/ar/eg/doctors/%D8%A7%D9%84%D9%82%D9%84%D8%A8/القاهرة`, `/en/eg/doctors/Internal_Medicine` or `/ar/eg/doctor/سارة-حسن`. None of these is a page: each answers ONE 301 to the
 * clean canonical URL when every segment can be resolved to a canonical one, otherwise it stays a 404. Only the shape is decided here; the target page
 * still applies its own 200/301/404 rules (slug history, thin-page guard), so this can never create a second URL for a page.
 */
const SEGMENT = /^[a-z0-9-]{2,60}$/;

const SPECIALTY_BY_ARABIC: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [code, label] of Object.entries(SPECIALTY_LABELS)) {
    const seg = code.replace(/_/g, '-');
    const n = normalizeArabic(label.ar);
    m.set(n, seg); m.set(n.replace(/^ال/, ''), seg); m.set(normalizeArabic(label.en), seg);
  }
  return m;
})();

function toSegment(raw: string): string | null {
  if (SEGMENT.test(raw)) return raw;
  const lower = raw.toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
  if (SEGMENT.test(lower)) return lower;
  const bySpec = SPECIALTY_BY_ARABIC.get(normalizeArabic(raw)) ?? SPECIALTY_BY_ARABIC.get(normalizeArabic(raw).replace(/^ال/, ''));
  if (bySpec) return bySpec;
  const place = slugifyPlace(raw.replace(/-/g, ' '));
  return place && SEGMENT.test(place) ? place : null;
}

export function looseRedirectTarget(pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const m = /^\/(ar|en)\/([a-z]{2})(\/.*)?$/i.exec(decoded);
  if (!m) return null;
  const segs = (m[3] ?? '').split('/').filter(Boolean);
  if (!segs.length || segs.length > 4) return null;
  const out: string[] = [];
  for (const [i, s] of segs.entries()) {
    // the first segment is a route keyword (doctors, doctor, clinic, locations ...): never transliterate it
    const t = i === 0 ? s.toLowerCase() : toSegment(s);
    if (!t) return null;
    out.push(t);
  }
  const target = `/${m[1]!.toLowerCase()}/${m[2]!.toLowerCase()}/${out.join('/')}`;
  if (target === pathname) return null;
  return parsePublicPath(target).kind === 'match' ? target : null;
}
