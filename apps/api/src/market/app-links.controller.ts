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
  /**
   * RFC 9116 `/.well-known/security.txt` (G-26). Contact comes from `SECURITY_CONTACT` (a person decides the mailbox: NEEDS_HUMAN); until it is set the file carries the placeholder
   * `TODO_NEEDS_HUMAN` and production answers 404 so a placeholder is never published as a real disclosure channel. `Expires` is one year ahead of the start of the current UTC day.
   */
  @Public() @Get('security.txt')
  securityTxt(@Res() res: Response) {
    const contact = process.env.SECURITY_CONTACT?.trim();
    if (!contact && cfg().isProd) { res.status(404).json({ code: 'NOT_CONFIGURED', message: 'Security contact is not configured' }); return; }
    const d = new Date(); const expires = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())).toISOString();
    const lines = [`Contact: ${contact || 'mailto:TODO_NEEDS_HUMAN@invalid'}`, `Expires: ${expires}`, 'Preferred-Languages: en, ar', ...(process.env.SECURITY_POLICY_URL ? [`Policy: ${process.env.SECURITY_POLICY_URL}`] : [])];
    res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=3600'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!contact) res.setHeader('X-Kiorex-Security-Txt', 'placeholder');
    res.status(200).send(`${lines.join('\n')}\n`);
  }
  @Public() @Get('assetlinks.json')
  assetlinks(@Res() res: Response) { const r = resolveAppLinksConfig(appLinksConfigFromEnv()); this.serve(res, buildAssetLinks(r), r.fingerprintPlaceholder); }
}
