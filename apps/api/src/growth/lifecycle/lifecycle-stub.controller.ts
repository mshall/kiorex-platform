import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { GROWTH_FLAG } from '../growth-flags';
import { notBuiltYet } from '../growth-stub';

/** GRW-P2-X1 stub of the lifecycle journeys view. Replaced by GRW-P2-E (W6). */
@ApiExcludeController()
@Controller('admin/growth/lifecycle')
export class LifecycleStubController {
  @Public() @Get() list() { throw notBuiltYet(GROWTH_FLAG.LIFECYCLE_JOURNEYS, 'GRW-P2-E'); }
}
