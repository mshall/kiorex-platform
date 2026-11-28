import { Injectable, Logger } from '@nestjs/common';
import { PARTNER_API_PATH } from '@kiorex/contracts';
import { cfg } from '../common/config';
import { ApiError, unavailable } from '../common/errors';
import { partnerRequest, PartnerHttpError, PartnerTransientError } from '../common/partner-http';

export type ProductKind = 'PHARMACY' | 'LAB';

export interface ProductPriceRow { id: string; edition: string; marketCode: string; interval: string; currency: string; amount: string; validFrom: string; validTo: string | null; priceVersion: number; proposalId: string | null; proposedBy: string | null; publishedBy: string | null; createdAt: string }
export interface ProductPlansOverview { editions: string[]; prices: ProductPriceRow[]; organisations: Array<{ edition: string; marketCode: string; count: number }> }

/**
 * Signed, platform-level door to the plan prices of the Pharmacy and the Lab (the products own the rows). One credential pair for both products
 * (KIORLY_PLANS_ADMIN_CLIENT_KEY/SECRET), the host from the partner base URL. Nothing is cached here beyond what the caller keeps; an unset credential means "not configured".
 */
@Injectable()
export class ProductPlansClient {
  private readonly log = new Logger('product-plans');

  configured(): boolean { const c = cfg(); return !!c.plansAdminClientKey && c.plansAdminClientSecret.length >= 24; }

  private conn(kind: ProductKind) {
    const c = cfg();
    return { baseUrl: kind === 'PHARMACY' ? c.pharmacyBaseUrl : c.labBaseUrl, clientKey: c.plansAdminClientKey, clientSecret: c.plansAdminClientSecret, timeoutMs: Math.min(c.partnerTimeoutMs, 6000) };
  }
  private path(kind: ProductKind, rest: string) { return `${kind === 'PHARMACY' ? PARTNER_API_PATH.pharmacy : PARTNER_API_PATH.lab}/plans${rest}`; }

  private async call<T>(kind: ProductKind, method: string, rest: string, body?: unknown): Promise<T> {
    if (!this.configured()) throw unavailable('PRODUCT_PRICES_NOT_CONFIGURED', 'The price connection to this product is not configured; nothing was changed.');
    try {
      return (await partnerRequest<T>(this.conn(kind), { method, path: this.path(kind, rest), body })).data;
    } catch (e) {
      if (e instanceof PartnerHttpError) {
        const b = (e.body ?? {}) as { code?: string; message?: string; details?: unknown };
        throw new ApiError(e.status === 404 || e.status === 401 ? 503 : e.status, e.status === 404 ? 'PRODUCT_PRICES_UNAVAILABLE' : e.status === 401 ? 'PRODUCT_PRICES_REJECTED' : String(b.code ?? `PRODUCT_${e.status}`), typeof b.message === 'string' ? b.message : 'The product refused the request', b.details && typeof b.details === 'object' ? { details: b.details } : {});
      }
      if (e instanceof PartnerTransientError) throw unavailable('PRODUCT_UNAVAILABLE', 'The product is not reachable right now; nothing was changed. Try again in a moment.', { retryable: true, kind: e.kind });
      throw e;
    }
  }

  private cache = new Map<ProductKind, { at: number; value: ProductPlansOverview }>();
  invalidate() { this.cache.clear(); }
  /** For the public site: cached 60 s, the last good copy for up to a day when the product is down, null when never reachable (the site then shows no price, never an invented one). */
  async cachedOverview(kind: ProductKind): Promise<ProductPlansOverview | null> {
    const hit = this.cache.get(kind);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    if (!this.configured()) return null;
    try {
      const value = await this.overview(kind);
      this.cache.set(kind, { at: Date.now(), value });
      return value;
    } catch (e) {
      this.log.warn(`${kind} prices unavailable: ${(e as Error).message}`);
      return hit && Date.now() - hit.at < 24 * 3_600_000 ? hit.value : null;
    }
  }

  overview(kind: ProductKind) { return this.call<ProductPlansOverview>(kind, 'GET', ''); }
  price<T = any>(kind: ProductKind, body: Record<string, unknown>) { return this.call<T>(kind, 'POST', '/prices', body); }
}
