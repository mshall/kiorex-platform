import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { badRequest } from '../common/errors';
import { RequiresFlag } from '../control-plane/control-plane-public';
import { MarketService } from '../market/market-public';
import { CatalogService, SearchParams } from './catalog.service';
import { ProviderProfileDto, ProviderSlotsDto, SearchResultDto, SponsoredResultDto, ViewResultDto } from './catalog.dto';
import { SpecialtyDto } from '../common/shared.dto';

const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly svc: CatalogService, private readonly markets: MarketService) {}

  @ApiOkResponse({ type: SearchResultDto })

  @Public() @Get('search/providers')
  @ApiOperation({ summary: 'KXM-DS-01..04/06 search; emergency keywords return 123 guidance and no results' })
  search(
    @Query('q') q?: string, @Query('specialty') specialty?: string, @Query('governorate') governorate?: string, @Query('area') area?: string,
    @Query('minFee') minFee?: string, @Query('maxFee') maxFee?: string, @Query('gender') gender?: string, @Query('language') language?: string,
    @Query('minRating') minRating?: string, @Query('acceptsDeposit') acceptsDeposit?: string, @Query('nextAvailable') nextAvailable?: string,
    @Query('sort') sort?: string, @Query('lat') lat?: string, @Query('lng') lng?: string, @Query('maxDistanceKm') maxDistanceKm?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
  ) {
    if (sort && !['earliest', 'distance', 'rating', 'fee'].includes(sort)) throw badRequest('INVALID_SORT', 'sort must be earliest|distance|rating|fee');
    if (nextAvailable && !['today', 'tomorrow', 'week'].includes(nextAvailable)) throw badRequest('INVALID_NEXT_AVAILABLE', 'nextAvailable must be today|tomorrow|week');
    const p: SearchParams = {
      q, specialty, governorate, area, gender, language, nextAvailable: nextAvailable as SearchParams['nextAvailable'], sort: sort as SearchParams['sort'],
      minFee: num(minFee), maxFee: num(maxFee), minRating: num(minRating), lat: num(lat), lng: num(lng), maxDistanceKm: num(maxDistanceKm), page: num(page), pageSize: num(pageSize),
      acceptsDeposit: acceptsDeposit === undefined ? undefined : acceptsDeposit === 'true',
    };
    return this.svc.search(p);
  }

  @ApiOkResponse({ type: SpecialtyDto, isArray: true })

  @Public() @Get('specialties') @ApiOperation({ summary: 'Specialty codes with AR/EN labels' })
  specialties() { return this.svc.specialties(); }

  @ApiOkResponse({ type: ProviderProfileDto })

  @Public() @Get('providers/:id') @ApiOperation({ summary: 'KXM-PR-01/02/04 provider profile' })
  profile(@Param('id') id: string) { return this.svc.profile(id); }

  @ApiOkResponse({ type: ProviderSlotsDto })

  @Public() @Get('providers/:id/slots') @ApiOperation({ summary: 'KXM-BK-01 slots from Kiorly (60 s cache)' })
  async slots(@Param('id') id: string, @Query('typeId') typeId: string, @Query('from') from?: string, @Query('to') to?: string) {
    if (!typeId) throw badRequest('TYPE_REQUIRED', 'typeId required');
    const p = await this.svc.getRow(id);
    await this.markets.assertLive(p.market);
    const f = from ? new Date(from) : new Date();
    const t = to ? new Date(to) : new Date(f.getTime() + 7 * 86400_000);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw badRequest('INVALID_RANGE', 'invalid from/to');
    await this.svc.track('slot_viewed', { providerId: id });
    return { providerId: id, typeId, slots: await this.svc.slots(p, typeId, f, t) };
  }

  @ApiOkResponse({ type: ViewResultDto })

  @Public() @Post('providers/:id/view') @HttpCode(200) @ApiOperation({ summary: 'KXM-DS-08 count a profile view (pushed daily to Kiorly)' })
  view(@Param('id') id: string) { return this.svc.recordProfileView(id); }

  @ApiOkResponse({ type: SponsoredResultDto })

  @Public() @Get('search/sponsored') @RequiresFlag('kiorex.sponsored_listings') @ApiOperation({ summary: 'Sponsored listings (P3, flag kiorex.sponsored_listings). No sponsorship commercial terms exist yet (NEEDS_HUMAN): always empty, always labelled' })
  sponsored() { return { items: [], sponsored: true, label: 'SPONSORED' }; }
}
