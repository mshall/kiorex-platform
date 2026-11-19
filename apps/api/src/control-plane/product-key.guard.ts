import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ApiError } from '../common/errors';
import { verifyControlPlaneRequest } from '../common/hmac';
import { FlagsService } from './flags.service';

const nonces = new Map<string, number>();

/** HMAC product-key auth (same canonical scheme as marketplace; X-Kiorex-Product-Key identifies the product). */
@Injectable()
export class ProductKeyGuard implements CanActivate {
  constructor(private readonly flags: FlagsService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const keyId = String(req.headers['x-kiorex-product-key'] ?? '');
    if (!keyId) throw new ApiError(401, 'PRODUCT_KEY_REQUIRED', 'X-Kiorex-Product-Key required');
    const reg = await this.flags.productSecret(keyId);
    if (!reg) throw new ApiError(401, 'UNKNOWN_PRODUCT_KEY', 'Unknown product key');
    const r = verifyControlPlaneRequest({ headers: req.headers, method: req.method, path: req.originalUrl.split('?')[0], body: req.rawBody ?? Buffer.alloc(0), secret: reg.secret });
    if (!r.ok) throw new ApiError(401, `HMAC_${r.reason.toUpperCase()}`, 'Request signature rejected');
    const nonce = String(req.headers['x-kiorly-nonce'] ?? '');
    const now = Date.now();
    for (const [k, t] of nonces) if (now - t > 5 * 60_000) nonces.delete(k);
    const nk = `${keyId}:${nonce}`;
    if (nonces.has(nk)) throw new ApiError(401, 'NONCE_REUSED', 'Nonce already used');
    nonces.set(nk, now);
    req.product = reg.product;
    return true;
  }
}
