import { Injectable, Logger } from '@nestjs/common';
import { validateEvent } from '@kiorex/contracts';
import { cfg } from '../common/config';
import { ApiError } from '../common/errors';
import { verifyWebhook } from '../common/hmac';
import { BookingService } from '../booking/booking-public';
import { CatalogService } from '../catalog/catalog-public';
import { EngagementService } from '../engagement/engagement-public';
import { PrismaService } from '../prisma/prisma.service';
import { TrustService } from '../trust/trust-public';

const BOOKING_EVENTS = new Set(['APPOINTMENT_CONFIRMED', 'RESCHEDULED', 'APPOINTMENT_RESCHEDULED', 'CANCELLED_BY_CLINIC', 'CANCELLED_BY_PATIENT', 'CHECKED_IN', 'CHECK_IN_REVERTED', 'COMPLETED', 'NO_SHOW', 'MARKETPLACE_BOOKING_CONFIRM_TIMEOUT']);

/** Kiorly → Kiorex webhooks: HMAC-verified, de-duplicated on eventId, drive the KX-03 §05 transitions. */
@Injectable()
export class WebhooksService {
  private readonly log = new Logger('webhooks');
  constructor(private readonly prisma: PrismaService, private readonly booking: BookingService, private readonly catalog: CatalogService, private readonly engagement: EngagementService, private readonly trust: TrustService) {}

  async receive(raw: string, h: { signature?: string; timestamp?: string; eventIdHeader?: string }) {
    if (!verifyWebhook(cfg().kiorlyWebhookSecret, h.signature, raw, h.timestamp)) throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature rejected');
    let env: any;
    try { env = JSON.parse(raw); } catch { throw new ApiError(400, 'INVALID_JSON', 'Body is not JSON'); }
    const eventId: string = env.eventId ?? h.eventIdHeader;
    if (!eventId || !env.type) throw new ApiError(400, 'INVALID_ENVELOPE', 'eventId and type required');
    if (!cfg().isProd) {
      const v = validateEvent(env.type, env); // schema drift is logged, never rejected (forward compatible)
      if (!v.valid) this.log.warn(`event ${env.type} failed contract schema: ${(v as any).errors?.slice(0, 2).join('; ')}`);
    }
    // dedupe on eventId (insert-or-ignore is the lock)
    const inserted = await this.prisma.webhookReceipt.createMany({ data: [{ eventId, source: 'kiorly', type: env.type, aggregateId: env.aggregateId, payload: env }], skipDuplicates: true });
    if (!inserted.count) return { status: 'DUPLICATE' };
    try {
      const outcome = await this.route(env);
      await this.prisma.webhookReceipt.update({ where: { eventId }, data: { status: outcome === 'IGNORED' || outcome === 'UNKNOWN_BOOKING' ? 'IGNORED' : 'PROCESSED', processedAt: new Date(), error: outcome === 'UNKNOWN_BOOKING' ? 'not a Kiorex booking' : null } });
      return { status: outcome };
    } catch (e) {
      // allow Kiorly's retry to re-deliver: drop the receipt so the next attempt is processed
      await this.prisma.webhookReceipt.delete({ where: { eventId } }).catch(() => undefined);
      throw new ApiError(500, 'WEBHOOK_PROCESSING_FAILED', (e as Error).message);
    }
  }

  private async route(env: { type: string; aggregateId?: string; data?: Record<string, any> }): Promise<string> {
    const data = env.data ?? {};
    const type = env.type;
    if (BOOKING_EVENTS.has(type)) return this.booking.applyEvent({ type, aggregateId: env.aggregateId, data });
    switch (type) {
      case 'SLOTS_CHANGED': // aggregateId = clinicianId
        this.catalog.invalidateSlots(data.clinicianId ?? env.aggregateId);
        return 'APPLIED';
      case 'PROVIDER_PROFILE_UPDATED':
      case 'LISTING_STATUS_CHANGED': // reindex; PAUSED listings are hidden by the sync (status column)
        this.catalog.invalidateSlots(data.clinicianId);
        await this.catalog.syncOnce();
        return 'APPLIED';
      case 'REVIEW_INVITATION_ELIGIBLE': return this.trust.onInvitationEligible(data);
      case 'REVIEW_REPLY_POSTED': return this.trust.onReply(data);
      case 'COMMISSION_CHARGE_CREATED':
      case 'COMMISSION_CHARGE_REVERSED': // reporting only: Kiorly decides attendance/commission (KX-09 §06)
        await this.prisma.auditLog.create({ data: { actor: 'kiorly', action: `finance.${type.toLowerCase()}`, resource: 'Appointment', resourceId: env.aggregateId, metadata: data as any } });
        return 'APPLIED';
      default:
        return 'IGNORED'; // unknown / v2 events: acknowledge for forward compatibility
    }
  }
}
