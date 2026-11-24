import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { etagMatches, etagOf, textSecurityHeaders } from './headers';
import { buildRobots } from './robots';
import { LOCALES } from './url-policy';
import { siteCfg } from './site.config';

@Injectable()
export class RobotsController {
  handle = (req: Request, res: Response): void => {
    const c = siteCfg();
    const body = buildRobots({ indexable: c.indexable, canonicalHost: c.canonicalHost, locales: LOCALES });
    const etag = etagOf(body);
    res.set({ ...textSecurityHeaders(), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=3600', ETag: etag, ...(c.indexable ? {} : { 'X-Robots-Tag': 'noindex' }) });
    if (etagMatches(req.headers['if-none-match'], etag)) { res.status(304).end(); return; }
    res.status(200).send(body);
  };
}
