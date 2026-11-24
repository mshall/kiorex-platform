import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { etagMatches, etagOf, publicCacheControl, textSecurityHeaders } from './headers';
import { SeoConfigService } from './seo-config.service';
import { SitemapService } from './sitemap.service';

@Injectable()
export class SitemapController {
  constructor(private readonly sitemaps: SitemapService, private readonly seo: SeoConfigService) {}

  index = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try { await this.send(req, res, (await this.sitemaps.indexXml())); } catch (e) { next(e); }
  };

  shard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const r = await this.sitemaps.shardXml(String(req.params.file ?? ''));
      if (!r) { res.status(404).set({ ...textSecurityHeaders(), 'Cache-Control': 'public, max-age=0, s-maxage=60', 'Content-Type': 'text/plain; charset=utf-8' }).send('Not found'); return; }
      await this.send(req, res, r);
    } catch (e) { next(e); }
  };

  private async send(req: Request, res: Response, r: { xml: string; lastmod: Date | null }): Promise<void> {
    const seo = await this.seo.get();
    const etag = etagOf(r.xml);
    res.set({
      ...textSecurityHeaders(), 'Content-Type': 'application/xml; charset=utf-8', ETag: etag, 'Cache-Control': publicCacheControl({ sMaxAge: Math.min(seo.edgeCacheSeconds * 3, 900), staleWhileRevalidate: seo.staleWhileRevalidateSeconds }),
      ...(r.lastmod ? { 'Last-Modified': r.lastmod.toUTCString() } : {}),
    });
    if (etagMatches(req.headers['if-none-match'], etag)) { res.status(304).end(); return; }
    res.status(200).send(r.xml);
  }
}
