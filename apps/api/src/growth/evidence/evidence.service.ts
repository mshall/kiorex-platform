import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AttributionService } from '../attribution/attribution.service';
import { growthError } from '../growth-errors';

/**
 * Per-booking evidence (ARCH 6.6): facts, not a recomputation. The stored decision, its policy version and the ordered touches it considered.
 * Never returns visitor keys, ip hashes, click-id hashes or any person identifier; a touch shows only kind, link code, time and dwell.
 */
@Injectable()
export class EvidenceService {
  constructor(private readonly prisma: PrismaService, private readonly attribution: AttributionService) {}

  async forBooking(bookingId: string, scope: { orgId?: string } = {}) {
    const booking = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId }, select: { id: true, tenantId: true, providerId: true } });
    const decision = booking ? await this.attribution.latest(bookingId) : null;
    // another organisation's booking answers exactly like a missing one (no oracle)
    const tenantId = booking ? (booking.tenantId ?? (await this.prisma.provider.findUnique({ where: { id: booking.providerId }, select: { tenantId: true } }))?.tenantId ?? null) : null;
    if (!booking || !decision || (scope.orgId !== undefined && tenantId !== scope.orgId)) throw growthError('GROWTH_EVIDENCE_NOT_FOUND', 'No attribution evidence for this booking');
    const touches = await this.prisma.growthTouchpoint.findMany({ where: { id: { in: decision.evidenceTouchIds } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
    return {
      bookingId,
      decision: { id: decision.id, origin: decision.origin, reason: decision.reasonCode, policyVersion: decision.policyVersionId, inputsHash: decision.inputsHash, supersedesId: decision.supersedesId, createdAt: decision.createdAt.toISOString() },
      touches: touches.map((t) => ({ id: t.id, kind: t.kind, ...(t.linkCode ? { ref: t.linkCode } : {}), occurredAt: t.occurredAt.toISOString(), dwellMs: t.dwellMs, winning: t.id === decision.winningTouchId })),
    };
  }
}
