import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { BootstrapDto } from './bootstrap.dto';
import { Bootstrap, BootstrapService } from './bootstrap.service';

@ApiTags('bootstrap')
@Controller('bootstrap')
export class BootstrapController {
  constructor(private readonly svc: BootstrapService) {}

  @Public() @Get()
  @Header('Cache-Control', 'public, max-age=60')
  @Header('Vary', 'Accept-Encoding')
  @ApiOperation({ summary: 'Market-aware app and web bootstrap: live markets, regional API endpoint and capabilities. Public, cacheable for 60 seconds. The market comes from the account or link context (?cc=), never from the caller location.' })
  @ApiQuery({ name: 'cc', required: false, description: 'Market hint from a link or the signed-in account (ISO alpha-2). Honoured only when that market is live; otherwise the default market is returned.' })
  @ApiOkResponse({ description: 'Bootstrap', type: BootstrapDto })
  get(@Query('cc') cc?: string): Promise<Bootstrap> { return this.svc.get(cc); }
}
