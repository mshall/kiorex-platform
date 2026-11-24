import { Injectable, Logger } from '@nestjs/common';
import type { WidgetRegistration } from '../prisma/generated/client';
import { PrismaService } from '../prisma/prisma.service';
import { WidgetAuditService } from './widget-audit.service';
import { allowedOrigins, sanitizeRegisteredOrigins } from './widget-origins';

const SLUG = /^[a-z0-9-]{3,60}$/;

export interface ProfileUpdate { clinicId?: unknown; widgetOrigins?: unknown; clinic?: { bookingSlug?: unknown; slug?: unknown } | null; bookingSlug?: unknown }

/**
 * `WidgetRegistration` writer and reader (GRW-P1-G). The registration is a PROJECTION: the Clinic is the source of truth for a clinic's widget origins and sends them in
 * `PROVIDER_PROFILE_UPDATED.widgetOrigins` (contracts 1.10.0). Kiorex keeps only the verified result (contract-valid exact https origins, at most 10) keyed by the Clinic
 * id (`orgRef` = the clinic that owns the widget settings). Nothing here ever accepts an origin from a request.
 */
@Injectable()
export class WidgetRegistrationService {
  private readonly log = new Logger('widget');
  constructor(private readonly prisma: PrismaService, private readonly audit: WidgetAuditService) {}

  /** Called by the Kiorly webhook consumer on PROVIDER_PROFILE_UPDATED. Idempotent: the same payload twice writes no second audit row. */
  async upsertFromProfile(data: ProfileUpdate): Promise<'APPLIED' | 'IGNORED'> {
    const orgRef = typeof data.clinicId === 'string' && data.clinicId.length > 0 && data.clinicId.length <= 80 ? data.clinicId : null;
    if (!orgRef) return 'IGNORED';
    const origins = sanitizeRegisteredOrigins(data.widgetOrigins);
    const rawSlug = data.clinic?.bookingSlug ?? data.clinic?.slug ?? data.bookingSlug;
    const slug = typeof rawSlug === 'string' && SLUG.test(rawSlug) ? rawSlug : null;
    const prev = await this.prisma.widgetRegistration.findUnique({ where: { orgRef } });
    const same = prev && prev.origins.length === origins.length && prev.origins.every((o, i) => o === origins[i]) && (!slug || prev.orgSlug === slug);
    if (same) { await this.prisma.widgetRegistration.update({ where: { orgRef }, data: { syncedAt: new Date() } }); return 'APPLIED'; }
    await this.prisma.widgetRegistration.upsert({
      where: { orgRef },
      create: { orgRef, orgSlug: slug, origins, status: 'ACTIVE' },
      update: { origins, ...(slug ? { orgSlug: slug } : {}), syncedAt: new Date() },
    });
    await this.audit.registrationSynced(orgRef, prev?.origins ?? [], origins);
    return 'APPLIED';
  }

  /** `:orgSlug` of the embed URL: the clinic booking slug projected from the Clinic, else the clinic's Kiorex slug (GrowthSlug CLINIC), else the clinic id itself. */
  async resolve(slugOrRef: string): Promise<WidgetRegistration | null> {
    const key = slugOrRef.trim();
    if (!key || key.length > 80) return null;
    const direct = await this.prisma.widgetRegistration.findFirst({ where: { OR: [{ orgSlug: key }, { orgRef: key }] } });
    if (direct) return direct;
    const gs = await this.prisma.growthSlug.findFirst({ where: { entityType: 'CLINIC', slug: key }, select: { entityId: true } });
    return gs ? this.prisma.widgetRegistration.findUnique({ where: { orgRef: gs.entityId } }) : null;
  }

  byOrg(orgRef: string) { return this.prisma.widgetRegistration.findUnique({ where: { orgRef } }); }

  /** Effective embedding origins right now (verified origins plus non-production dev origins); empty when the registration is disabled. */
  effectiveOrigins(reg: Pick<WidgetRegistration, 'origins' | 'status'>): string[] { return reg.status === 'ACTIVE' ? allowedOrigins(reg.origins) : []; }

  list(take = 100) { return this.prisma.widgetRegistration.findMany({ orderBy: { updatedAt: 'desc' }, take }); }
}
