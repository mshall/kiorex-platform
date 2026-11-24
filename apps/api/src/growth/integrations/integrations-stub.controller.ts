import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { notBuiltYet } from '../growth-stub';

/** GRW-P2-X1 stub of the integration runs view. Replaced by GRW-P2-F (W6). Each integration kind has its own flag growth.integrations.<kind>. */
@ApiExcludeController()
@Controller('admin/growth/integration-runs')
export class IntegrationsStubController {
  @Public() @Get() list() { throw notBuiltYet('growth.integrations.googleads', 'GRW-P2-F'); }
}
