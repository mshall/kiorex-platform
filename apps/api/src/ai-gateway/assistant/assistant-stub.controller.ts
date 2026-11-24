import { Controller, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { ApiError } from '../../common/errors';

const notBuiltYet = (key: string, pkg: string) => new ApiError(404, 'FEATURE_DISABLED', `Not available yet (${pkg})`, { key, scope: 'global', pkg, stub: true });

/** GRW-P2-X1 stub of POST /growth/v1/assistant/link (secure booking link verification). Replaced by GRW-P2-D (W6). */
@ApiExcludeController()
@Controller('growth/v1/assistant')
export class AssistantStubController {
  @Public() @Post('link') link() { throw notBuiltYet('kiorex.whatsapp_ai_assistant', 'GRW-P2-D'); }
}
