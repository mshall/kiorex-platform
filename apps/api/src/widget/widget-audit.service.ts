import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WidgetLimiter } from './widget-limiter';

export type DenyReason = 'ORIGIN_NOT_ALLOWED' | 'REFERER_NOT_ALLOWED' | 'ORIGIN_MISMATCH' | 'NO_PARENT' | 'TOKEN_INVALID' | 'ROUTE_NOT_ALLOWED' | 'OUT_OF_SCOPE' | 'MUST_BE_EMBEDDED';

/**
 * Ops-visible audit of the widget (GRW-P1-G): every refused origin and every allow-list change lands in `AuditLog` (resource `WidgetRegistration`, actions
 * `widget.origin_denied` and `widget.registration_synced`), readable by ops at GET /api/v1/widget/v1/ops/audit. Denials are written at most once per
 * (organisation, origin, reason) per hour so a hostile page cannot flood the log. The claimed origin is sanitised and shortened; no IP address or identifier is stored.
 */
@Injectable()
export class WidgetAuditService {
  constructor(private readonly prisma: PrismaService, private readonly limiter: WidgetLimiter) {}

  private safe(v: string | null | undefined): string { return (v ?? '').replace(/[^\x21-\x7e]/g, '').slice(0, 120); }

  async denied(orgRef: string | null, claimedOrigin: string | null | undefined, reason: DenyReason, surface: string): Promise<void> {
    const origin = this.safe(claimedOrigin);
    const r = await this.limiter.limiter.hit(`widget-audit:${orgRef ?? '-'}:${origin}:${reason}`, 1, 3_600_000);
    if (!r.ok) return;
    await this.prisma.auditLog.create({ data: { actor: 'widget', action: 'widget.origin_denied', resource: 'WidgetRegistration', resourceId: orgRef ?? undefined, metadata: { reason, origin, surface } } }).catch(() => undefined);
  }

  async registrationSynced(orgRef: string, before: string[], after: string[]): Promise<void> {
    await this.prisma.auditLog.create({ data: { actor: 'kiorly', action: 'widget.registration_synced', resource: 'WidgetRegistration', resourceId: orgRef, metadata: { before, after } } });
  }

  async list(o: { orgRef?: string; limit?: number } = {}) {
    return this.prisma.auditLog.findMany({
      where: { resource: 'WidgetRegistration', ...(o.orgRef ? { resourceId: o.orgRef } : {}) },
      orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(o.limit ?? 100, 1), 500),
    });
  }
}
