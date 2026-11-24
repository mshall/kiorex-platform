import { Injectable } from '@nestjs/common';
import { composeDocument } from './head';
import type { PageData } from './site-data.types';
import { SiteDataService } from './site-data.service';
import { SeoConfigService } from './seo-config.service';
import { SiteRenderer } from './ssr-renderer';
import { siteCfg } from './site.config';
import { canonicalUrl, hreflangAlternates, parsePublicPath, type Locale } from './url-policy';

export interface PageCapture {
  status: number;
  /** the complete HTML document the visitor would get (head and body) */
  document: string;
  bodyHtml: string;
  data: PageData | null;
  type: string;
  params: Record<string, string>;
  rest: string;
  /** the guard's verdict, before the environment and any quality decision */
  guardIndexable: boolean;
  noindexReasons: string[];
  meta: { title: string; description: string };
}

/**
 * Renders one public page for ANALYSIS (the SEO quality gate): the same load and the same SSR bundle as the request handler, the same head composition, but no cache, no headers, no
 * environment gate (a staging site is analysed as if it were indexable) and no quality decision. Read-only; it never touches the page cache.
 */
@Injectable()
export class PageSnapshotService {
  constructor(private readonly data: SiteDataService, private readonly renderer: SiteRenderer, private readonly seo: SeoConfigService) {}

  available(): boolean { return this.renderer.available(); }

  async capture(market: string, locale: Locale, rest: string): Promise<PageCapture | null> {
    const cc = market.toLowerCase();
    const path = `/${locale}/${cc}${rest ? `/${rest}` : ''}`;
    const parsed = parsePublicPath(path);
    if (parsed.kind !== 'match') return null;
    const route = parsed.value; const q = { page: 1, sort: null } as const;
    const loaded = await this.data.load(route, q);
    if (loaded.status !== 200) return { status: loaded.status, document: '', bodyHtml: '', data: null, type: route.type, params: route.params, rest: route.rest, guardIndexable: false, noindexReasons: [], meta: { title: '', description: '' } };
    const cfg = siteCfg(); const seo = await this.seo.get(market);
    const out = await this.renderer.render({ locale, cc, type: route.type, path, query: q, data: loaded.data, site: { canonicalHost: cfg.canonicalHost, reviewMarkup: seo.reviewMarkupEnabled, templates: seo.templates } });
    const doc = composeDocument({
      locale, cc, canonical: canonicalUrl(cfg.canonicalHost, path, q), alternates: hreflangAlternates(cfg.canonicalHost, route.cc, route.rest), indexable: loaded.indexable, title: out.meta.title, description: out.meta.description,
      ogImage: out.meta.ogImage ?? `${cfg.canonicalHost}/og-image.png`, siteName: 'Kiorex', jsonLd: out.jsonLd, bodyHtml: out.html,
      state: { locale, cc, type: route.type, path, query: q, data: loaded.data }, assets: { css: '', script: null, modulePreloads: [], fontPreloads: [] },
    });
    return { status: 200, document: doc.html, bodyHtml: out.html, data: loaded.data, type: route.type, params: route.params, rest: route.rest, guardIndexable: loaded.indexable, noindexReasons: loaded.noindexReasons, meta: { title: out.meta.title, description: out.meta.description } };
  }
}
