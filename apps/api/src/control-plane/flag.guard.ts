import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FlagsService } from './flags.service';

export const REQUIRES_FLAG = 'kx:requires-flag';
/** OFF => 403 FEATURE_DISABLED {key, scope}. Market from `X-Kiorex-Market` (default EG). */
export const RequiresFlag = (key: string) => SetMetadata(REQUIRES_FLAG, key);

@Injectable()
export class FlagGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly flags: FlagsService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(REQUIRES_FLAG, [ctx.getHandler(), ctx.getClass()]);
    if (!key) return true;
    const req = ctx.switchToHttp().getRequest();
    await this.flags.assertEnabled(key, { market: String(req.headers['x-kiorex-market'] ?? 'EG') });
    return true;
  }
}
