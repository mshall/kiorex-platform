import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';
import { LiveDto, ReadyDto } from './health.dto';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOkResponse({ type: LiveDto })

  @Public() @Get('live')
  live() {
    return { status: 'ok' };
  }

  @ApiOkResponse({ type: ReadyDto })

  @Public() @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', db: 'up' };
    } catch {
      throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'database unavailable' });
    }
  }
}
