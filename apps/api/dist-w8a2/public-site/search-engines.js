"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SitemapSubmitJob = exports.SearchEngineService = exports.UnconfiguredRealSearchEngine = exports.MockSearchEngine = void 0;
exports.verificationCfg = verificationCfg;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const site_config_1 = require("./site.config");
const TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
const GOOGLE_FILE = /^google[a-z0-9]{8,64}\.html$/;
const env = (k) => process.env[k]?.trim() ?? '';
function verificationCfg() {
    const gm = env('SITE_GOOGLE_SITE_VERIFICATION');
    const bm = env('SITE_BING_SITE_VERIFICATION');
    const gf = env('SITE_GOOGLE_VERIFICATION_FILE');
    const bu = env('SITE_BING_AUTH_USER');
    return {
        googleMeta: TOKEN.test(gm) ? gm : null,
        bingMeta: TOKEN.test(bm) ? bm : null,
        googleFile: GOOGLE_FILE.test(gf) ? { name: gf, body: `google-site-verification: ${gf}` } : null,
        bingAuthXml: TOKEN.test(bu) ? `<?xml version="1.0"?>\n<users>\n\t<user>${bu}</user>\n</users>\n` : null,
    };
}
class MockSearchEngine {
    name;
    submitted = [];
    constructor(name) {
        this.name = name;
    }
    async submitSitemap(sitemapUrl) {
        const r = { engine: this.name, sitemap: sitemapUrl, accepted: true, mode: 'mock', at: new Date().toISOString(), note: 'MOCK: nothing was sent to the search engine' };
        this.submitted.push(r);
        if (this.submitted.length > 50)
            this.submitted.shift();
        return r;
    }
    async performance() {
        return ['home', 'hub', 'city', 'district', 'doctor', 'clinic'].map((pageType, i) => ({ engine: this.name, pageType, impressions: 1000 - i * 120, clicks: 60 - i * 7, avgPosition: Math.round((8 + i * 1.5) * 10) / 10, sample: true }));
    }
}
exports.MockSearchEngine = MockSearchEngine;
class UnconfiguredRealSearchEngine {
    name;
    constructor(name) {
        this.name = name;
    }
    async submitSitemap() { throw new Error(`SITE_SEARCH_ENGINE_MODE=real: the ${this.name} adapter is not implemented (NEEDS_HUMAN: property verification and API credentials)`); }
    async performance() { throw new Error(`SITE_SEARCH_ENGINE_MODE=real: the ${this.name} adapter is not implemented (NEEDS_HUMAN)`); }
}
exports.UnconfiguredRealSearchEngine = UnconfiguredRealSearchEngine;
let SearchEngineService = class SearchEngineService {
    log = new common_1.Logger('SearchEngines');
    mode = env('SITE_SEARCH_ENGINE_MODE') === 'real' ? 'real' : 'mock';
    engines = this.mode === 'real' ? [new UnconfiguredRealSearchEngine('google'), new UnconfiguredRealSearchEngine('bing')] : [new MockSearchEngine('google'), new MockSearchEngine('bing')];
    status() {
        const v = verificationCfg();
        return { mode: this.mode, environment: (0, site_config_1.siteCfg)().environment, engines: this.engines.map((e) => e.name), verification: { googleMeta: !!v.googleMeta, bingMeta: !!v.bingMeta, googleFile: v.googleFile?.name ?? null, bingAuthFile: !!v.bingAuthXml }, sitemap: `${(0, site_config_1.siteCfg)().canonicalHost}/sitemap.xml`, submissions: this.recent() };
    }
    recent() { return this.engines.flatMap((e) => (e instanceof MockSearchEngine ? e.submitted : [])).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 20); }
    async submitSitemap() {
        const url = `${(0, site_config_1.siteCfg)().canonicalHost}/sitemap.xml`;
        const out = [];
        for (const e of this.engines)
            out.push(await e.submitSitemap(url));
        return out;
    }
    async performance(o = {}) {
        const to = o.to ?? new Date().toISOString().slice(0, 10);
        const from = o.from ?? new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
        return (await Promise.all(this.engines.map((e) => e.performance({ from, to })))).flat();
    }
};
exports.SearchEngineService = SearchEngineService;
exports.SearchEngineService = SearchEngineService = __decorate([
    (0, common_1.Injectable)()
], SearchEngineService);
let SitemapSubmitJob = class SitemapSubmitJob {
    engines;
    log = new common_1.Logger('SitemapSubmitJob');
    timer;
    constructor(engines) {
        this.engines = engines;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled || !(0, site_config_1.siteCfg)().indexable)
            return;
        this.timer = setInterval(() => void this.runOnce(), 24 * 3_600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async runOnce() {
        try {
            return await this.engines.submitSitemap();
        }
        catch (e) {
            this.log.warn(`sitemap submission failed: ${e.message}`);
            return [];
        }
    }
};
exports.SitemapSubmitJob = SitemapSubmitJob;
exports.SitemapSubmitJob = SitemapSubmitJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [SearchEngineService])
], SitemapSubmitJob);
//# sourceMappingURL=search-engines.js.map