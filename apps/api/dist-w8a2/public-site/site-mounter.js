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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SiteRoleGuard = exports.SiteMounter = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const compression_1 = __importDefault(require("compression"));
const render_controller_1 = require("./render.controller");
const robots_controller_1 = require("./robots.controller");
const search_engines_1 = require("./search-engines");
const sitemap_controller_1 = require("./sitemap.controller");
const site_config_1 = require("./site.config");
let SiteMounter = class SiteMounter {
    host;
    render;
    robots;
    sitemaps;
    log = new common_1.Logger('PublicSite');
    constructor(host, render, robots, sitemaps) {
        this.host = host;
        this.render = render;
        this.robots = robots;
        this.sitemaps = sitemaps;
    }
    onModuleInit() {
        const cfg = (0, site_config_1.siteCfg)();
        const app = this.host.httpAdapter?.getInstance();
        if (!cfg.mounted || !app || typeof app.get !== 'function') {
            this.log.log(`public site not mounted (role=${cfg.role}, enabled=${cfg.mounted})`);
            return;
        }
        if (process.env.SITE_COMPRESSION !== 'false')
            app.use((0, compression_1.default)({ threshold: 1024, filter: (req, res) => /^\/(_p\/|ar\/|en\/|sitemap|robots|manifest)/.test(req.path) && compression_1.default.filter(req, res) }));
        app.get('/robots.txt', this.robots.handle);
        app.get('/sitemap.xml', this.sitemaps.index);
        app.get(/^\/sitemaps\/([A-Za-z0-9._-]+)$/, (req, res, next) => { req.params.file = String(req.params[0] ?? ''); void this.sitemaps.shard(req, res, next); });
        app.get(/^\/(google[a-z0-9]{8,64}\.html|BingSiteAuth\.xml)$/, (req, res, next) => {
            const v = (0, search_engines_1.verificationCfg)();
            const name = String(req.params[0] ?? '');
            if (cfg.indexable && v.googleFile && name === v.googleFile.name) {
                res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).send(v.googleFile.body);
                return;
            }
            if (cfg.indexable && v.bingAuthXml && name === 'BingSiteAuth.xml') {
                res.status(200).set({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).send(v.bingAuthXml);
                return;
            }
            next();
        });
        app.get('/_site/health', this.render.health);
        app.get('/_site/metrics', this.render.metrics);
        app.get(/^\/_p\/.+$/, this.render.assets);
        app.get(/^\/(favicon\.svg|favicon-32\.png|favicon\.ico|apple-touch-icon\.png|manifest\.webmanifest|og-image\.png|kiorex-mark\.svg|pwa\/[a-z0-9-]+\.png)$/, this.render.brandAsset);
        app.get('/doctors/:id', this.render.legacyDoctor);
        app.get('/', this.render.root);
        app.get(/^\/(ar|en)\/([a-z]{2})(\/.*)?$/i, this.render.handle);
        this.log.log(`public site mounted (role=${cfg.role}, environment=${cfg.environment}, indexable=${cfg.indexable})`);
    }
};
exports.SiteMounter = SiteMounter;
exports.SiteMounter = SiteMounter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.HttpAdapterHost, render_controller_1.RenderController, robots_controller_1.RobotsController, sitemap_controller_1.SitemapController])
], SiteMounter);
let SiteRoleGuard = class SiteRoleGuard {
    canActivate(ctx) {
        if ((0, site_config_1.siteCfg)().role !== 'site')
            return true;
        const url = ctx.switchToHttp().getRequest().originalUrl ?? '';
        if (/^\/api\/v1\/health(\/|\?|$)/.test(url))
            return true;
        throw new common_1.NotFoundException();
    }
};
exports.SiteRoleGuard = SiteRoleGuard;
exports.SiteRoleGuard = SiteRoleGuard = __decorate([
    (0, common_1.Injectable)()
], SiteRoleGuard);
//# sourceMappingURL=site-mounter.js.map