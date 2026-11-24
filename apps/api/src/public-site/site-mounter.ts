import { CanActivate, ExecutionContext, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import compression from 'compression';
import type { Express } from 'express';
import { RenderController } from './render.controller';
import { RobotsController } from './robots.controller';
import { verificationCfg } from './search-engines';
import { SitemapController } from './sitemap.controller';
import { siteCfg } from './site.config';

/**
 * Mounts the public-site routes on the HTTP adapter at module init (Nest routes the /api/v1 surface; these live at the host root, so they cannot
 * sit under the global prefix). Order: specific routes first, the /{ar,en}/{cc}/* catch-all last. ROLE=api mounts nothing.
 * The well-known app-link files are owned by GRW-P1-H (market module) and are not duplicated here.
 */
@Injectable()
export class SiteMounter implements OnModuleInit {
  private readonly log = new Logger('PublicSite');
  constructor(private readonly host: HttpAdapterHost, private readonly render: RenderController, private readonly robots: RobotsController, private readonly sitemaps: SitemapController) {}

  onModuleInit(): void {
    const cfg = siteCfg();
    const app = this.host.httpAdapter?.getInstance() as Express | undefined;
    if (!cfg.mounted || !app || typeof app.get !== 'function') { this.log.log(`public site not mounted (role=${cfg.role}, enabled=${cfg.mounted})`); return; }
    // gzip/brotli-less text compression for the public site only (HTML, JSON-LD, the /_p JS and CSS): the CDN compresses in production, but the origin must not
    // ship 340 KB of uncompressed JavaScript to a client that asks for gzip (Lighthouse uses-text-compression, slow 4G). Fonts and images are already compressed.
    if (process.env.SITE_COMPRESSION !== 'false') app.use(compression({ threshold: 1024, filter: (req, res) => /^\/(_p\/|ar\/|en\/|sitemap|robots|manifest)/.test(req.path) && compression.filter(req, res) }));
    app.get('/robots.txt', this.robots.handle);
    app.get('/sitemap.xml', this.sitemaps.index);
    app.get(/^\/sitemaps\/([A-Za-z0-9._-]+)$/, (req, res, next) => { req.params.file = String(req.params[0] ?? ''); void this.sitemaps.shard(req, res, next); });
    // search engine ownership files (names and tokens are configuration; a missing config answers 404, never a placeholder)
    app.get(/^\/(google[a-z0-9]{8,64}\.html|BingSiteAuth\.xml)$/, (req, res, next) => {
      const v = verificationCfg(); const name = String(req.params[0] ?? '');
      if (cfg.indexable && v.googleFile && name === v.googleFile.name) { res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).send(v.googleFile.body); return; }
      if (cfg.indexable && v.bingAuthXml && name === 'BingSiteAuth.xml') { res.status(200).set({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' }).send(v.bingAuthXml); return; }
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
}

/** ROLE=site: the process serves the public site only; the /api/v1 surface answers 404 except health (so a split deployment cannot be used as a second API). */
@Injectable()
export class SiteRoleGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (siteCfg().role !== 'site') return true;
    const url: string = ctx.switchToHttp().getRequest().originalUrl ?? '';
    if (/^\/api\/v1\/health(\/|\?|$)/.test(url)) return true;
    throw new NotFoundException();
  }
}
