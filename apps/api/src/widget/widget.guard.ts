import { DEFAULT_MARKET } from '../market/market-core-public';
import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { GROWTH_ERROR_STATUS } from '@kiorex/contracts';
import { ApiError, forbidden } from '../common/errors';
import { ipHashOf } from '../common/privacy-hash';
import { FlagsService } from '../control-plane/control-plane-public';
import { PrismaService } from '../prisma/prisma.service';
import { FRAUD_SCORER, type FraudScorer } from '../growth/fraud/fraud-public';
import { WidgetAuditService } from './widget-audit.service';
import { WidgetLimiter, widgetLimits } from './widget-limiter';
import { originOfUrl, widgetSelfOrigin } from './widget-origins';
import { WidgetPolicyService } from './widget-policy.service';
import { WidgetRegistrationService } from './widget-registration.service';
import { verifyWidgetToken } from './widget-token';

export const WIDGET_HEADER = 'x-kx-widget';

/** API calls a widget token may make (everything else answers 403 WIDGET_ROUTE_NOT_ALLOWED): the token is not a general credential. */
const P = '/api/v1';
const ROUTES: { m: string; re: RegExp; cls: 'config' | 'slots' | 'read' | 'book' | 'confirm' | 'touch' | 'profile' }[] = [
  { m: 'GET', re: new RegExp(`^${P}/widget/v1/config$`), cls: 'config' },
  { m: 'GET', re: new RegExp(`^${P}/providers/([^/]+)/slots$`), cls: 'slots' },
  { m: 'GET', re: new RegExp(`^${P}/providers/([^/]+)$`), cls: 'read' },
  { m: 'GET', re: new RegExp(`^${P}/specialties$`), cls: 'read' },
  { m: 'POST', re: new RegExp(`^${P}/bookings$`), cls: 'book' },
  { m: 'POST', re: new RegExp(`^${P}/bookings/([^/]+)/(confirm|release|deposit-checkout)$`), cls: 'confirm' },
  { m: 'GET', re: new RegExp(`^${P}/bookings/([^/]+)$`), cls: 'read' },
  { m: 'GET', re: new RegExp(`^${P}/me/profile$`), cls: 'read' },
  { m: 'PUT', re: new RegExp(`^${P}/me/profile$`), cls: 'profile' },
  { m: 'POST', re: new RegExp(`^${P}/growth/v1/touch$`), cls: 'touch' },
];

/**
 * Per-request enforcement for widget traffic (GRW-P1-G). A request that carries `X-KX-Widget: <token>` must present a valid, unexpired token, for an organisation whose
 * registration is ACTIVE and whose allow-list STILL contains the origin the token is bound to (revocation is immediate), flag `growth.widgets` effective, an `Origin`
 * (or `Referer`) equal to the widget host itself (the widget app is the only caller), a route from the table above, a provider that belongs to the token's organisation,
 * and a rate-limit slot in the shared Postgres limiter. Bookings made with a token are forced to channel CLINIC_LINK with the registration's booking slug, so a widget can
 * never create a marketplace booking. Requests without the header are untouched (the public API behaves exactly as before).
 */
@Injectable()
export class WidgetRequestGuard implements CanActivate {
  constructor(
    private readonly flags: FlagsService, private readonly regs: WidgetRegistrationService, private readonly audit: WidgetAuditService,
    private readonly limiter: WidgetLimiter, private readonly prisma: PrismaService, private readonly policy: WidgetPolicyService,
    @Optional() @Inject(FRAUD_SCORER) private readonly fraud?: FraudScorer,
  ) {}

  /** The audit write plus the fraud scorer's view of the denial (best effort, shadow by default). */
  private async deny(org: string | null, origin: string | null | undefined, reason: Parameters<WidgetAuditService['denied']>[2], surface: string): Promise<void> {
    await this.audit.denied(org, origin, reason, surface);
    if (this.fraud) void this.fraud.onWidgetDenied({ org, origin, reason }).catch(() => undefined);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const raw = req.headers?.[WIDGET_HEADER];
    if (raw === undefined) return true;
    const token = Array.isArray(raw) ? raw[0] : raw;
    const path: string = String(req.originalUrl ?? req.url ?? '').split('?')[0]!;
    const method: string = String(req.method ?? 'GET').toUpperCase();
    const v = verifyWidgetToken(token);
    if (!v.ok) { await this.deny(null, req.headers?.origin, 'TOKEN_INVALID', path); throw new ApiError(401, 'WIDGET_TOKEN_INVALID', 'Widget session is not valid or has expired', { reason: v.reason }); }
    const { org, origin } = v.claims;
    // GRW-P3-D: an origin the fraud rules throttled (enforced rule, reversible, ends by itself) answers 429 like any rate limit
    if (await this.fraud?.originThrottled(origin)) throw new ApiError(429, 'WIDGET_ORIGIN_THROTTLED', 'Too many requests from this site, try again later');
    await this.flags.assertEnabled('growth.widgets', { market: DEFAULT_MARKET });
    const route = ROUTES.find((r) => r.m === method && r.re.test(path));
    if (!route) { await this.deny(org, origin, 'ROUTE_NOT_ALLOWED', `${method} ${path}`); throw forbidden('WIDGET_ROUTE_NOT_ALLOWED', 'This request is not available to the widget'); }
    const reg = await this.regs.byOrg(org);
    const allowed = reg ? this.regs.effectiveOrigins(reg) : [];
    const sandbox = v.claims.sbx === 1 && originOfUrl(origin) === widgetSelfOrigin(req.protocol, req.headers?.host);
    if (!reg || (!allowed.includes(origin) && !sandbox)) { await this.deny(org, origin, 'ORIGIN_NOT_ALLOWED', path); throw new ApiError(GROWTH_ERROR_STATUS.GROWTH_WIDGET_ORIGIN_NOT_ALLOWED, 'GROWTH_WIDGET_ORIGIN_NOT_ALLOWED', 'This site is not allowed to embed the booking widget'); }
    // the widget app is the only legitimate caller: its own origin must appear in Origin (or, for same-origin GETs that omit it, Referer)
    const self = widgetSelfOrigin(req.protocol, req.headers?.host);
    const seen = originOfUrl(req.headers?.origin) ?? (method === 'GET' ? originOfUrl(req.headers?.referer) : null);
    if ((seen && seen !== self) || (!seen && method !== 'GET')) { await this.deny(org, seen ?? req.headers?.origin ?? '', 'ORIGIN_MISMATCH', path); throw forbidden('WIDGET_ORIGIN_MISMATCH', 'Request did not come from the widget'); }

    const ip = ipHashOf(req.ip); const L = widgetLimits();
    switch (route.cls) {
      case 'slots':
        await this.limiter.take('slots-ip', ip, L.slotsPerMinIp); await this.limiter.take('slots-org', org, L.slotsPerMinOrg);
        await this.assertProviderInScope(org, route.re.exec(path)![1]!); break;
      case 'book': {
        await this.limiter.take('booking-ip', ip, L.bookingPerMinIp);
        const body = req.body ?? {};
        await this.assertProviderInScope(org, String(body.providerId ?? ''));
        // the widget can only make provider-led bookings: force the channel and the page slug (a client-supplied value is overwritten)
        body.channel = 'CLINIC_LINK'; body.bookingPageSlug = reg.orgSlug ?? reg.orgRef; req.body = body;
        const sub: string | undefined = req.user?.sub;
        if (sub) { // slot hoarding: at most N unexpired holds per person made through any widget (WIDGET_POLICY.maxActiveHoldsPerPhone)
          const max = (await this.policy.get()).maxActiveHoldsPerPhone;
          const held = await this.prisma.bookingIntent.count({ where: { sub, status: 'HELD', channel: 'CLINIC_LINK', holdExpiresAt: { gt: new Date() } } });
          if (held >= max) throw new ApiError(429, 'WIDGET_HOLD_LIMIT', 'You already hold the maximum number of slots; finish or release one first', { max });
        }
        break;
      }
      case 'confirm': await this.limiter.take('confirm-ip', ip, L.confirmPerMinIp); break;
      case 'profile': { // the widget may only set the display name and the language of a person it just signed in (low-friction registration), never the national ID, e-mail or date of birth
        const b = req.body ?? {};
        req.body = { ...(typeof b.nameEn === 'string' ? { nameEn: b.nameEn.slice(0, 120) } : {}), ...(b.preferredLocale === 'ar' || b.preferredLocale === 'en' ? { preferredLocale: b.preferredLocale } : {}) };
        await this.limiter.take('confirm-ip', ip, L.confirmPerMinIp); break;
      }
      case 'config': await this.limiter.take('config-ip', ip, L.configPerMin); break;
      default: break;
    }
    if (route.cls === 'book' || route.cls === 'confirm') req.headers['x-kx-platform'] = 'widget'; // growth stream platform (closed set), set by the server, not the client
    req.widget = { org, origin, orgSlug: reg.orgSlug ?? reg.orgRef, sandbox };
    return true;
  }

  private async assertProviderInScope(org: string, providerId: string) {
    const p = providerId ? await this.prisma.provider.findUnique({ where: { id: providerId }, select: { clinicId: true } }) : null;
    if (p && p.clinicId !== org) { await this.deny(org, null, 'OUT_OF_SCOPE', 'provider'); throw forbidden('WIDGET_PROVIDER_OUT_OF_SCOPE', 'This provider is not part of the widget'); }
  }
}
