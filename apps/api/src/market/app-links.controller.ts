import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/auth';
import { cfg } from '../common/config';
import { appLinksConfigFromEnv, buildAppleAppSiteAssociation, buildAssetLinks, resolveAppLinksConfig } from './app-links';

/**
 * `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` (outside the /api/v1 prefix, see app.setup.ts).
 * `application/json`, never a redirect. Production answers 404 until the Team ID and signing fingerprint are configured (NEEDS_HUMAN).
 * The public-site role (GRW-P1-E) can reuse the builders from market-public.ts when it fronts the patient host.
 */
@ApiExcludeController()
@Controller('.well-known')
export class AppLinksController {
  private serve(res: Response, body: unknown, placeholder: boolean) {
    if (placeholder && cfg().isProd) { res.status(404).json({ code: 'NOT_CONFIGURED', message: 'App link association is not configured' }); return; }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (placeholder) res.setHeader('X-Kiorex-App-Links', 'placeholder');
    res.status(200).send(JSON.stringify(body));
  }
  @Public() @Get('apple-app-site-association')
  aasa(@Res() res: Response) { const r = resolveAppLinksConfig(appLinksConfigFromEnv()); this.serve(res, buildAppleAppSiteAssociation(r), r.teamPlaceholder); }
  @Public() @Get('assetlinks.json')
  assetlinks(@Res() res: Response) { const r = resolveAppLinksConfig(appLinksConfigFromEnv()); this.serve(res, buildAssetLinks(r), r.fingerprintPlaceholder); }
}
