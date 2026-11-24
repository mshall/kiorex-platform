import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';
import { providerStatus } from '../common/providers/startup';
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
  providers() {
    return { providers: providerStatus() };
  }

  @ApiOkResponse({ type: ReadyDto })

  @Public() @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', db: 'up', providers: providerStatus() };
    } catch {
      throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'database unavailable' });
    }
  }
}
