import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg as appCfg } from '../common/config';
import { siteCfg } from './site.config';

/**
 * Search Console and Bing Webmaster scaffolding (GRW-P1-F). Founder rule: integrations are MOCKED until the go-live pass.
 *
 *  - Verification (ownership proof) is configuration, never code: `SITE_GOOGLE_SITE_VERIFICATION` / `SITE_BING_SITE_VERIFICATION` render a `<meta>` tag on
 *    the HOME page only, `SITE_GOOGLE_VERIFICATION_FILE` serves `/{google....html}` and `SITE_BING_AUTH_USER` serves `/BingSiteAuth.xml`. Tokens are
 *    public by design (they sit in page source) but are validated so a typo can never inject markup.
 *  - `SearchEnginePort` is the integration boundary: sitemap submission and the performance pull (impressions, clicks, position per page type). The mock
 *    records submissions and returns deterministic, clearly labelled sample rows; `SITE_SEARCH_ENGINE_MODE=real` is NEEDS_HUMAN (OAuth client or service
 *    account for Search Console, Bing API key, property verification) and refuses to run rather than pretend.
 *  - The submission job runs only in the production environment (other environments are noindex and have no sitemap entries).
 */
const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
const GOOGLE_FILE = /^google[a-z0-9]{8,64}\.html$/;
const env = (k: string): string => process.env[k]?.trim() ?? '';

export interface Verification { googleMeta: string | null; bingMeta: string | null; googleFile: { name: string; body: string } | null; bingAuthXml: string | null }
export function verificationCfg(): Verification {
  const gm = env('SITE_GOOGLE_SITE_VERIFICATION'); const bm = env('SITE_BING_SITE_VERIFICATION'); const gf = env('SITE_GOOGLE_VERIFICATION_FILE'); const bu = env('SITE_BING_AUTH_USER');
  return {
    googleMeta: TOKEN.test(gm) ? gm : null,
    bingMeta: TOKEN.test(bm) ? bm : null,
    googleFile: GOOGLE_FILE.test(gf) ? { name: gf, body: `google-site-verification: ${gf}` } : null,
    bingAuthXml: TOKEN.test(bu) ? `<?xml version="1.0"?>\n<users>\n\t<user>${bu}</user>\n</users>\n` : null,
  };
}

export type EngineName = 'google' | 'bing';
export interface SubmitResult { engine: EngineName; sitemap: string; accepted: boolean; mode: 'mock' | 'real'; at: string; note?: string }
export interface PerformanceRow { engine: EngineName; pageType: string; impressions: number; clicks: number; avgPosition: number; sample: boolean }
export interface SearchEnginePort {
  readonly name: EngineName;
  submitSitemap(sitemapUrl: string): Promise<SubmitResult>;
  performance(o: { from: string; to: string }): Promise<PerformanceRow[]>;
}

export class MockSearchEngine implements SearchEnginePort {
  readonly submitted: SubmitResult[] = [];
  constructor(readonly name: EngineName) {}
  async submitSitemap(sitemapUrl: string): Promise<SubmitResult> {
    const r: SubmitResult = { engine: this.name, sitemap: sitemapUrl, accepted: true, mode: 'mock', at: new Date().toISOString(), note: 'MOCK: nothing was sent to the search engine' };
    this.submitted.push(r); if (this.submitted.length > 50) this.submitted.shift();
    return r;
  }
  async performance(): Promise<PerformanceRow[]> {
    // deterministic sample so dashboards can be built and tested; flagged `sample: true` so nobody mistakes it for data
    return ['home', 'hub', 'city', 'district', 'doctor', 'clinic'].map((pageType, i) => ({ engine: this.name, pageType, impressions: 1000 - i * 120, clicks: 60 - i * 7, avgPosition: Math.round((8 + i * 1.5) * 10) / 10, sample: true }));
  }
}

/** The real adapters are a go-live task (Docs/NEEDS_HUMAN.md "Provider go-live"). They fail loudly. */
export class UnconfiguredRealSearchEngine implements SearchEnginePort {
  constructor(readonly name: EngineName) {}
  async submitSitemap(): Promise<SubmitResult> { throw new Error(`SITE_SEARCH_ENGINE_MODE=real: the ${this.name} adapter is not implemented (NEEDS_HUMAN: property verification and API credentials)`); }
  async performance(): Promise<PerformanceRow[]> { throw new Error(`SITE_SEARCH_ENGINE_MODE=real: the ${this.name} adapter is not implemented (NEEDS_HUMAN)`); }
}

@Injectable()
export class SearchEngineService {
  private readonly log = new Logger('SearchEngines');
  readonly mode: 'mock' | 'real' = env('SITE_SEARCH_ENGINE_MODE') === 'real' ? 'real' : 'mock';
  private readonly engines: SearchEnginePort[] = this.mode === 'real' ? [new UnconfiguredRealSearchEngine('google'), new UnconfiguredRealSearchEngine('bing')] : [new MockSearchEngine('google'), new MockSearchEngine('bing')];

  status() {
    const v = verificationCfg();
    return { mode: this.mode, environment: siteCfg().environment, engines: this.engines.map((e) => e.name), verification: { googleMeta: !!v.googleMeta, bingMeta: !!v.bingMeta, googleFile: v.googleFile?.name ?? null, bingAuthFile: !!v.bingAuthXml }, sitemap: `${siteCfg().canonicalHost}/sitemap.xml`, submissions: this.recent() };
  }
  recent(): SubmitResult[] { return this.engines.flatMap((e) => (e instanceof MockSearchEngine ? e.submitted : [])).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 20); }

  async submitSitemap(): Promise<SubmitResult[]> {
    const url = `${siteCfg().canonicalHost}/sitemap.xml`;
    const out: SubmitResult[] = [];
    for (const e of this.engines) out.push(await e.submitSitemap(url));
    return out;
  }
  async performance(o: { from?: string; to?: string } = {}): Promise<PerformanceRow[]> {
    const to = o.to ?? new Date().toISOString().slice(0, 10); const from = o.from ?? new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
    return (await Promise.all(this.engines.map((e) => e.performance({ from, to })))).flat();
  }
}

/** Daily sitemap submission (production environment only, jobs enabled). Never throws into the process. */
@Injectable()
export class SitemapSubmitJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SitemapSubmitJob');
  private timer?: NodeJS.Timeout;
  constructor(private readonly engines: SearchEngineService) {}
  onModuleInit() {
    if (!appCfg().jobsEnabled || !siteCfg().indexable) return;
    this.timer = setInterval(() => void this.runOnce(), 24 * 3_600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async runOnce(): Promise<SubmitResult[]> {
    try { return await this.engines.submitSitemap(); } catch (e) { this.log.warn(`sitemap submission failed: ${(e as Error).message}`); return []; }
  }
}
