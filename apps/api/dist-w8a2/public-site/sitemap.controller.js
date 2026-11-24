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
exports.SitemapController = void 0;
const common_1 = require("@nestjs/common");
const headers_1 = require("./headers");
const seo_config_service_1 = require("./seo-config.service");
const sitemap_service_1 = require("./sitemap.service");
let SitemapController = class SitemapController {
    sitemaps;
    seo;
    constructor(sitemaps, seo) {
        this.sitemaps = sitemaps;
        this.seo = seo;
    }
    index = async (req, res, next) => {
        try {
            await this.send(req, res, (await this.sitemaps.indexXml()));
        }
        catch (e) {
            next(e);
        }
    };
    shard = async (req, res, next) => {
        try {
            const r = await this.sitemaps.shardXml(String(req.params.file ?? ''));
            if (!r) {
                res.status(404).set({ ...(0, headers_1.textSecurityHeaders)(), 'Cache-Control': 'public, max-age=0, s-maxage=60', 'Content-Type': 'text/plain; charset=utf-8' }).send('Not found');
                return;
            }
            await this.send(req, res, r);
        }
        catch (e) {
            next(e);
        }
    };
    async send(req, res, r) {
        const seo = await this.seo.get();
        const etag = (0, headers_1.etagOf)(r.xml);
        res.set({
            ...(0, headers_1.textSecurityHeaders)(), 'Content-Type': 'application/xml; charset=utf-8', ETag: etag, 'Cache-Control': (0, headers_1.publicCacheControl)({ sMaxAge: Math.min(seo.edgeCacheSeconds * 3, 900), staleWhileRevalidate: seo.staleWhileRevalidateSeconds }),
            ...(r.lastmod ? { 'Last-Modified': r.lastmod.toUTCString() } : {}),
        });
        if ((0, headers_1.etagMatches)(req.headers['if-none-match'], etag)) {
            res.status(304).end();
            return;
        }
        res.status(200).send(r.xml);
    }
};
exports.SitemapController = SitemapController;
exports.SitemapController = SitemapController = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [sitemap_service_1.SitemapService, seo_config_service_1.SeoConfigService])
], SitemapController);
//# sourceMappingURL=sitemap.controller.js.map