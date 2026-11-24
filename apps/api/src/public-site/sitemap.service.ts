import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { pageKeyOf, SEO_QUALITY, type SeoQualityPort } from '../growth/seo-automation/seo-automation-public';
import { buildPath, hreflangAlternates, LOCALES, canonicalUrl, parsePublicPath } from './url-policy';
import { buildSitemapIndex, buildUrlset, parseShardName, shardName } from './sitemap.xml';
import { RedirectsService } from './redirects.service';
import { SiteDataService } from './site-data.service';
import { SiteIndexService } from './site-index.service';
import { siteCfg } from './site.config';

export interface SitemapEntry { type: string; rest: string; lastmod: Date | null }
interface Built { at: number; entries: SitemapEntry[]; shardSize: number; host: string }

/**
 * Dynamic segmented sitemaps (ARCH 4.1 rule 7). Index at /sitemap.xml, shards at /sitemaps/{type}-{cc}-{locale}-{n}.xml, at most `sitemapShardSize`
 * (default 10,000) URLs each, `lastmod` = the real provider-profile change time, hreflang alternates on every URL. The entries come from the
 * SAME facet table and visibility rules the renderer uses, so noindex pages are never listed.
 */
@Injectable()
export class SitemapService {
  private built = new Map<string, Built>();
  constructor(private readonly data: SiteDataService, private readonly redirects: RedirectsService, private readonly index: SiteIndexService, private readonly moduleRef: ModuleRef) {}
  /** The quality port is resolved lazily: the SEO automation reads this service's entries through its own site port, so a constructor dependency would be a cycle. */
  private get quality(): SeoQualityPort | undefined { try { return this.moduleRef.get<SeoQualityPort>(SEO_QUALITY, { strict: false }); } catch { return undefined; } }

  invalidate(): void { this.built.clear(); }

  async entries(market: string): Promise<Built> {
    const hit = this.built.get(market);
    if (hit && Date.now() - hit.at < siteCfg().sitemapTtlSeconds * 1000) return hit;
    const s = await this.data.snapshot(market);
    const out: SitemapEntry[] = [];
    const maxOf = (ds: (Date | null | undefined)[]): Date | null => ds.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
    out.push({ type: 'home', rest: '', lastmod: maxOf(s.facets.visible.map((p) => p.lastModified)) });
    for (const f of s.facets.all) {
      if (!f.guard.indexable) continue;
      const path = buildPath('ar', market, f.type, f.params);
      out.push({ type: f.type, rest: path.split('/').slice(3).join('/'), lastmod: f.lastModified });
    }
    const visible = s.facets.visible;
    const slugs = await this.redirects.slugsFor(market, 'DOCTOR', visible.map((p) => p.id));
    for (const p of visible) {
      const slug = slugs.get(p.id);
      if (!slug) continue; // no slug yet: no canonical URL, so no sitemap entry
      const kind = p.careType === 'HOME_NURSING' ? 'nurse' : 'doctor';
      out.push({ type: kind, rest: `${kind}/${slug}`, lastmod: p.lastModified });
    }
    const byClinic = new Map<string, Date>();
    for (const p of visible) { const d = byClinic.get(p.clinicId); if (!d || p.lastModified > d) byClinic.set(p.clinicId, p.lastModified); }
    const clinicSlugs = await this.redirects.slugsFor(market, 'CLINIC', [...byClinic.keys()]);
    for (const [clinicId, lastmod] of byClinic) { const slug = clinicSlugs.get(clinicId); if (slug) out.push({ type: 'clinic', rest: `clinic/${slug}`, lastmod }); }
    // pharmacies and labs: LIVE partners with the feature flag effective (the same set the renderer serves)
    for (const [kind, entity] of [['pharmacy', 'PHARMACY'], ['lab', 'LAB']] as const) {
      const list = s.index.partners.filter((x) => x.kind === entity);
      const pslugs = await this.redirects.slugsFor(market, entity, list.map((x) => x.id));
      for (const x of list) { const slug = pslugs.get(x.id); if (slug) out.push({ type: kind, rest: `${kind}/${slug}`, lastmod: x.lastModified }); }
    }
    out.sort((a, b) => (a.type === b.type ? (a.rest < b.rest ? -1 : 1) : a.type < b.type ? -1 : 1));
    const built: Built = { at: Date.now(), entries: out, shardSize: Math.max(1, Math.min(s.seo.sitemapShardSize, 50_000)), host: siteCfg().canonicalHost };
    this.built.set(market, built);
    return built;
  }

  private group(b: Built): Map<string, SitemapEntry[]> {
    const g = new Map<string, SitemapEntry[]>();
    for (const e of b.entries) g.set(e.type, [...(g.get(e.type) ?? []), e]);
    return g;
  }

  /** /sitemap.xml. Non-production environments list nothing (robots blocks them anyway). */
  async indexXml(): Promise<{ xml: string; lastmod: Date | null }> {
    const cfg = siteCfg();
    const refs: { loc: string; lastmod: Date | null }[] = [];
    if (cfg.indexable) {
      for (const market of await this.index.liveMarkets()) {
        const b = await this.entries(market);
        for (const [type, list] of [...this.group(b)].sort(([a], [c]) => (a < c ? -1 : 1))) {
          for (const locale of LOCALES) {
            for (let n = 1; n <= Math.ceil(list.length / b.shardSize); n++) {
              const slice = list.slice((n - 1) * b.shardSize, n * b.shardSize);
              refs.push({ loc: `${b.host}/sitemaps/${shardName(type, market, locale, n)}`, lastmod: slice.reduce<Date | null>((m, e) => (e.lastmod && (!m || e.lastmod > m) ? e.lastmod : m), null) });
            }
          }
        }
      }
    }
    return { xml: buildSitemapIndex(refs), lastmod: refs.reduce<Date | null>((m, r) => (r.lastmod && (!m || r.lastmod > m) ? r.lastmod : m), null) };
  }

  /** One shard file, or null when the name is malformed, the market is not live, or the shard does not exist. */
  async shardXml(file: string): Promise<{ xml: string; lastmod: Date | null } | null> {
    const p = parseShardName(file);
    if (!p || !siteCfg().indexable) return null;
    const market = p.cc.toUpperCase();
    if (!(await this.index.marketLive(market))) return null;
    const b = await this.entries(market);
    let list = this.group(b).get(p.type);
    if (!list) return null;
    // GRW-P3-F: pages the quality gate set noindex (only with SEO_AUTOMATION.autoNoindex on) are not listed, so the sitemap never contains a noindex page
    const blocked = (await this.quality?.blockedSet(market, p.locale).catch(() => undefined)) ?? new Set<string>();
    if (blocked.size) {
      list = list.filter((e) => { const r = parsePublicPath(`/${p.locale}/${p.cc}${e.rest ? `/${e.rest}` : ''}`); return r.kind !== 'match' || !blocked.has(pageKeyOf(r.value.type, r.value.params)); });
      if (!list.length) return null;
    }
    const slice = list.slice((p.n - 1) * b.shardSize, p.n * b.shardSize);
    if (!slice.length) return null;
    const urls = slice.map((e) => ({
      loc: canonicalUrl(b.host, `/${p.locale}/${p.cc}${e.rest ? `/${e.rest}` : ''}`),
      lastmod: e.lastmod,
      alternates: hreflangAlternates(b.host, p.cc, e.rest),
    }));
    return { xml: buildUrlset(urls, b.shardSize), lastmod: slice.reduce<Date | null>((m, e) => (e.lastmod && (!m || e.lastmod > m) ? e.lastmod : m), null) };
  }
}

