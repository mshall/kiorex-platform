import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { badRequest, conflict } from '../common/errors';
import { FlagsService, RequiresFlag } from '../control-plane/control-plane-public';
import { MarketService } from '../market/market-public';
import { CatalogService, SearchParams } from './catalog.service';
import { CareTypeDto, HomeDistrictDto, ProviderProfileDto, ProviderSlotsDto, SearchResultDto, SponsoredResultDto, ViewResultDto } from './catalog.dto';
import { normalizeDistrict, ServiceLocation } from './provider-mapper';
import { SpecialtyDto } from '../common/shared.dto';

const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly svc: CatalogService, private readonly markets: MarketService, private readonly flags: FlagsService) {}

  @ApiOkResponse({ type: SearchResultDto })

  @Public() @Get('search/providers')
  @ApiOperation({ summary: 'KXM-DS-01..04/06 search; emergency keywords return 123 guidance and no results' })
  search(
    @Query('q') q?: string, @Query('specialty') specialty?: string, @Query('governorate') governorate?: string, @Query('area') area?: string,
    @Query('minFee') minFee?: string, @Query('maxFee') maxFee?: string, @Query('gender') gender?: string, @Query('language') language?: string,
    @Query('minRating') minRating?: string, @Query('acceptsDeposit') acceptsDeposit?: string, @Query('nextAvailable') nextAvailable?: string,
    @Query('sort') sort?: string, @Query('lat') lat?: string, @Query('lng') lng?: string, @Query('maxDistanceKm') maxDistanceKm?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
    @Query('careType') careType?: string, @Query('serviceLocation') serviceLocation?: string, @Query('district') district?: string, @Query('profession') profession?: string,
  ) {
    if (sort && !['earliest', 'distance', 'rating', 'fee'].includes(sort)) throw badRequest('INVALID_SORT', 'sort must be earliest|distance|rating|fee');
    if (nextAvailable && !['today', 'tomorrow', 'week'].includes(nextAvailable)) throw badRequest('INVALID_NEXT_AVAILABLE', 'nextAvailable must be today|tomorrow|week');
    const p: SearchParams = {
      q, specialty, governorate, area, gender, language, nextAvailable: nextAvailable as SearchParams['nextAvailable'], sort: sort as SearchParams['sort'],
      minFee: num(minFee), maxFee: num(maxFee), minRating: num(minRating), lat: num(lat), lng: num(lng), maxDistanceKm: num(maxDistanceKm), page: num(page), pageSize: num(pageSize),
      acceptsDeposit: acceptsDeposit === undefined ? undefined : acceptsDeposit === 'true',
      careType, serviceLocation, district, profession,
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
  async slots(@Param('id') id: string, @Query('typeId') typeId: string, @Query('from') from?: string, @Query('to') to?: string, @Query('serviceLocation') serviceLocation?: string, @Query('district') district?: string, @Query('lat') lat?: string, @Query('lng') lng?: string) {
    if (!typeId) throw badRequest('TYPE_REQUIRED', 'typeId required');
    const p = await this.svc.getRow(id);
    await this.markets.assertLive(p.market);
    const f = from ? new Date(from) : new Date();
    const t = to ? new Date(to) : new Date(f.getTime() + 7 * 86400_000);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw badRequest('INVALID_RANGE', 'invalid from/to');
    if (t.getTime() <= f.getTime()) throw badRequest('INVALID_RANGE', 'to must be after from'); // a reversed window used to reach Kiorly and come back as a 500
    if (t.getTime() - f.getTime() > 92 * 86400_000) throw badRequest('RANGE_TOO_LARGE', 'ask for at most 92 days of slots at a time');
    const loc = (serviceLocation ? String(serviceLocation).toUpperCase() : 'IN_CLINIC') as ServiceLocation;
    if (!['IN_CLINIC', 'HOME'].includes(loc)) throw badRequest('INVALID_SERVICE_LOCATION', 'serviceLocation must be IN_CLINIC|HOME');
    let d: string | undefined;
    if (loc === 'HOME') {
      // KXMHV02: home slots need kiorex.home_visits + a home-enabled provider + a district; out-of-zone is 422 OUT_OF_COVERAGE (never an empty list)
      await this.flags.assertEnabled('kiorex.home_visits', { market: p.market });
      d = normalizeDistrict(district) ?? undefined;
      if (!d) throw badRequest('DISTRICT_REQUIRED', 'Home slots need the patient district code (e.g. nasr-city)');
      if (!this.svc.isHomeEnabled(p)) throw conflict('HOME_NOT_OFFERED', 'This provider does not offer home visits');
      if (!this.svc.coversDistrict(p, d)) throw await this.svc.outOfCoverage(p, d);
    }
    await this.svc.track('slot_viewed', { providerId: id, serviceLocation: loc, district: d, careType: p.careType });
    return { providerId: id, typeId, serviceLocation: loc, district: d ?? null, slots: await this.svc.slots(p, typeId, f, t, { serviceLocation: loc, district: d, lat: num(lat), lng: num(lng) }) };
  }

  @ApiOkResponse({ type: CareTypeDto, isArray: true })

  @Public() @Get('care-types') @ApiOperation({ summary: 'KXMDS01 care-type categories (Doctors · Physiotherapy · Home nursing) with enabled state (flags kiorex.category.*)' })
  careTypes(@Query('market') market?: string) { return this.svc.careTypes(market ?? 'EG'); }

  @ApiOkResponse({ type: HomeDistrictDto, isArray: true })

  @Public() @Get('home/districts') @ApiOperation({ summary: 'KXMHV02 districts with at least one home-enabled provider (district level only)' })
  homeDistricts() { return this.svc.homeDistricts(); }

  @ApiOkResponse({ type: ViewResultDto })

  @Public() @Post('providers/:id/view') @HttpCode(200) @ApiOperation({ summary: 'KXM-DS-08 count a profile view (pushed daily to Kiorly)' })
  view(@Param('id') id: string) { return this.svc.recordProfileView(id); }

  @ApiOkResponse({ type: SponsoredResultDto })

  @Public() @Get('search/sponsored') @RequiresFlag('kiorex.sponsored_listings') @ApiOperation({ summary: 'Sponsored listings (P3, flag kiorex.sponsored_listings). No sponsorship commercial terms exist yet (NEEDS_HUMAN): always empty, always labelled' })
  sponsored() { return { items: [], sponsored: true, label: 'SPONSORED' }; }
}
