import { Controller, ForbiddenException, Get, Req, ServiceUnavailableException } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { hasInternalHealthAccess } from '../common/internal-access';
import { PrismaService } from '../prisma/prisma.service';
import { providerStatus } from '../common/providers/startup';
import { leadSigningStatus } from '../partner-leads/partner-leads-public';
import { LiveDto, ProvidersDto, ReadyDto } from './health.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOkResponse({ type: LiveDto })

  @Public() @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Active mode of every external provider (mock|real), the vendor in use and whether its required variables are present. Never returns a secret or value. */
  @ApiOkResponse({ type: ProvidersDto })
  @Public() @Get('providers')
  providers(@Req() req: { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }) {
    // KX-PT-L2: the provider directory is for the VPC / operators, not for the internet
    if (!hasInternalHealthAccess(req)) throw new ForbiddenException({ code: 'INTERNAL_ONLY', message: 'Provider status is available to internal callers only' });
    return { providers: providerStatus() };
  }

  @ApiOkResponse({ type: ReadyDto })

  @Public() @Get('ready')
  async ready(@Req() req: { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      // KX-PT-L2: the public answer says only that the process is ready; modes, vendors and the lead-signing state go to internal callers
      if (!hasInternalHealthAccess(req)) return { status: 'ready' };
      return { status: 'ready', db: 'up', providers: providerStatus(), leadSigning: leadSigningStatus() };
    } catch {
      throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'database unavailable' });
    }
  }
}
