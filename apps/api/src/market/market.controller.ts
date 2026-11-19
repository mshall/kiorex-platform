import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { MarketService } from './market.service';
import { MarketDto } from './market.dto';
import { ApiOkResponse } from '@nestjs/swagger';

@ApiTags('market')
@Controller('markets')
export class MarketController {
  constructor(private readonly svc: MarketService) {}
  @Public() @Get() @ApiOperation({ summary: 'Markets (countries) that are LIVE; use for the sign-up country picker. ?all=true also lists gated markets with their state' })
  @ApiOkResponse({ type: MarketDto, isArray: true })
  async list(@Query('all') all?: string) {
    const rows = await this.svc.list();
    return all === 'true' ? rows : rows.filter((r) => r.live);
  }
}
