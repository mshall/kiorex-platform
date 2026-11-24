import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { GROWTH_FLAG } from '../growth-flags';
import { notBuiltYet } from '../growth-stub';

/** GRW-P2-X1 stub of the campaign admin API. Replaced by GRW-P2-A in the same wave. */
@ApiExcludeController()
@Controller('admin/growth/campaigns')
export class CampaignsStubController {
  @Public() @Get() list() { throw notBuiltYet(GROWTH_FLAG.CAMPAIGNS, 'GRW-P2-A'); }
}
