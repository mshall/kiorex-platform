import { bookingLinkBaseUrl } from '../common/hosts';
import { Controller, Get, Headers, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/auth';
import { cfg } from '../common/config';
import { FlagsService } from '../control-plane/control-plane-public';
import { GROWTH_FLAG } from '../growth/growth-public';
import { chooseMarket, isRefCode, isSafeSegment, normalizeCc, normalizeLocale, normalizeProviderCode, type LinkLocale } from './deep-link-rules';
import { landingHeaders, newNonce, renderLanding, safeStoreUrl, safeWebOrigin, type LandingKind } from './link-landing';
import { MarketService } from './market.service';

/**
 * Fallback pages for links the app did not intercept: `/r/:code` (referral or campaign), `/q/:code` (provider link QR), `/a/:id` and
 * `/appointment/:id` (appointment management). Served outside /api/v1 (app.setup.ts). The only inputs are the path value (validated by an
 * allow-list pattern), `l` (ar|en) and `cc` (market hint); any other query parameter, including URL-valued ones, is never read.
 * Query values never reach a log: nothing here logs the request URL, and the code is not echoed in error bodies.
 */
@ApiExcludeController()
@Controller()
export class LinkLandingController {
  constructor(private readonly flags: FlagsService, private readonly markets: MarketService) {}

  private async page(res: Response, kind: LandingKind, value: string | null, q: { l?: unknown; cc?: unknown }, accept?: string) {
    if (!value) { res.status(404).json({ code: 'LINK_INVALID', message: 'This link is not valid' }); return; }
    const locale: LinkLocale = normalizeLocale(typeof q.l === 'string' ? q.l : /^\s*en/i.test(accept ?? '') ? 'en' : 'ar');
    const live = await this.markets.liveMarkets();
    const market = chooseMarket(normalizeCc(q.cc), live, (process.env.DEFAULT_MARKET ?? live[0] ?? '').toUpperCase());
    const c = cfg();
    const web = safeWebOrigin(c.webBaseUrl, c.isProd);
    const linkBase = safeWebOrigin(bookingLinkBaseUrl(), c.isProd);
    const webUrl = kind === 'appointment' ? `${web ?? ''}/appointments/${value}` : kind === 'provider' ? `${linkBase ?? ''}/q/${value}` : `${web ?? ''}/?ref=${value}`;
    if (!(await this.flags.isEnabled(GROWTH_FLAG.DEEP_LINKS, { market }))) { res.redirect(302, webUrl); return; } // flag OFF: links open the website
    const nonce = newNonce();
    const html = renderLanding({
      kind, value, locale, cc: market ? market.toLowerCase() : null, webUrl,
      iosStoreUrl: safeStoreUrl(process.env.IOS_APP_STORE_URL, 'ios'), androidStoreUrl: safeStoreUrl(process.env.ANDROID_PLAY_STORE_URL, 'android'),
      nonce, draftMarker: !c.isProd,
    });
    for (const [k, v] of Object.entries(landingHeaders(nonce))) res.setHeader(k, v);
    res.status(200).send(html);
  }

  @Public() @Get('r/:code')
  referral(@Param('code') code: string, @Query() q: Record<string, unknown>, @Headers('accept-language') al: string | undefined, @Res() res: Response) {
    return this.page(res, 'referral', isRefCode(code) ? code : null, q, al);
  }
  @Public() @Get('q/:code')
  provider(@Param('code') code: string, @Query() q: Record<string, unknown>, @Headers('accept-language') al: string | undefined, @Res() res: Response) {
    return this.page(res, 'provider', normalizeProviderCode(code), q, al);
  }
  @Public() @Get('a/:id')
  apptShort(@Param('id') id: string, @Query() q: Record<string, unknown>, @Headers('accept-language') al: string | undefined, @Res() res: Response) {
    return this.page(res, 'appointment', isSafeSegment(id) ? id : null, q, al);
  }
  @Public() @Get('appointment/:id')
  appt(@Param('id') id: string, @Query() q: Record<string, unknown>, @Headers('accept-language') al: string | undefined, @Res() res: Response) {
    return this.page(res, 'appointment', isSafeSegment(id) ? id : null, q, al);
  }
}
