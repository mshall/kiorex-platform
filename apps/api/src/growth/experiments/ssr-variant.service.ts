import { Injectable } from '@nestjs/common';
import { parseCookies, VISITOR_KEY_PATTERN } from '../touch/touch-sanitizer';
import { ExposureService, visitorUnit } from './exposure.service';
import { assertSurfaceAllowed, surfaceByKey } from './surfaces';
import { parseKxe } from './ssr-variant';

/** Page types of the public site that host an SSR experiment copy slot, and the (single) surface each hosts. Everything else renders control, always. */
export const SSR_SURFACE_BY_PAGE: Readonly<Record<string, string>> = { home: 'landing.home.hero_copy', doctor: 'landing.provider.cta_label', nurse: 'landing.provider.cta_label' };
export interface SsrVariant { surface: string; experiment: string; variant: string }

/** The surface a page type may host, or null: it must be on the allowlist, flagged `ssr`, and survive the same denylist check an experiment creation goes through. */
export function ssrSurfaceFor(pageType: string): string | null {
  const key = SSR_SURFACE_BY_PAGE[pageType]; if (!key) return null;
  const def = surfaceByKey(key); if (!def?.ssr || !def.platforms.includes('web') || !def.units.includes('VISITOR')) return null;
  try { assertSurfaceAllowed(key); } catch { return null; }
  return key;
}

/**
 * Server-side experiment variant for a public page request (GRW-P3-A, SSR slot). The page handler never reads the session; this is the ONE cookie read it makes, and it is a no-op unless
 * BOTH cookies exist: `kxv` (the visitor key, issued only with analytics consent and cleared on withdrawal) and `kxe` (set only with analytics consent). The variant is then RECOMPUTED from the
 * visitor key against the RUNNING experiments (flag, eligibility, allocation); a `kxe` entry that disagrees (tampered, stale, enrolment ended) renders control. Control, no consent and any
 * failure return null, and the page is served from the shared cache exactly as before.
 */
@Injectable()
export class SsrVariantService {
  constructor(private readonly exposure: ExposureService) {}

  async resolve(o: { cookieHeader: string | undefined; pageType: string; market: string; locale: 'ar' | 'en' }): Promise<SsrVariant | null> {
    const surface = ssrSurfaceFor(o.pageType); if (!surface) return null;
    const kxe = parseKxe(o.cookieHeader); if (kxe.size === 0) return null;
    const kxv = parseCookies(o.cookieHeader).kxv; if (!kxv || !VISITOR_KEY_PATTERN.test(kxv)) return null;
    try {
      const list = await this.exposure.assignments(visitorUnit(kxv), { market: o.market, locale: o.locale, platform: 'web' }, surface);
      const a = list.find((x) => x.surface === surface);
      if (!a || a.variant === 'control' || kxe.get(a.experiment) !== a.variant) return null;
      return { surface, experiment: a.experiment, variant: a.variant };
    } catch { return null; }
  }
}
