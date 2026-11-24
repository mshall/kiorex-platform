import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { GROWTH_FLAG } from '../growth-flags';
import { notBuiltYet } from '../growth-stub';

/** GRW-P2-X1 stub of the ops reward ledger view. Replaced by GRW-P2-B2 (W6). */
@ApiExcludeController()
@Controller('admin/growth/rewards')
export class RewardsStubController {
  @Public() @Get() list() { throw notBuiltYet(GROWTH_FLAG.REWARDS, 'GRW-P2-B2'); }
}
