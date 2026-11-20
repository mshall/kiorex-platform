import { cfg } from '../common/config';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Review } from '../prisma/generated/client';
import { createHash } from 'node:crypto';
import { badRequest, conflict, forbidden, notFound } from '../common/errors';
import { BookingService } from '../booking/booking-public';
import { CatalogService } from '../catalog/catalog-public';
import { FlagsService } from '../control-plane/control-plane-public';
import { EngagementService } from '../engagement/engagement-public';
import { KiorlyClient } from '../kiorly/kiorly-public';
import { OutboxService } from '../outbox/outbox-public';
import { PatientService } from '../patient/patient-public';
import { PrismaService } from '../prisma/prisma.service';
import { detectAbuse, detectPhi } from '../safety/safety-public';

const EDIT_WINDOW_MS = 7 * 24 * 3600_000;
/** NEEDS_HUMAN: complaint SLA hours (KXM-OP-05) — placeholder, not a committed commitment. */
const COMPLAINT_SLA_HOURS = 48;

export function moderate(text: string | undefined | null): { hidden: boolean; flags: string[] } {
  if (!text) return { hidden: false, flags: [] };
  const flags: string[] = [...detectPhi(text).map((k) => `PHI:${k}`)];
  if (detectAbuse(text)) flags.push('ABUSE');
  return { hidden: flags.length > 0, flags };
}

@Injectable()
export class TrustService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService, private readonly booking: BookingService, private readonly catalog: CatalogService, private readonly flags: FlagsService,
    private readonly engagement: EngagementService, private readonly kiorly: KiorlyClient, private readonly outbox: OutboxService, private readonly patients: PatientService,
  ) {}

  onModuleInit() {
    this.outbox.register('kiorly.reviews_sync', (e) => this.syncProvider(e.payload.providerId));
    this.patients.registerExport('reviews', async (sub) => this.prisma.review.findMany({ where: { sub }, select: { id: true, rating: true, text: true, status: true, createdAt: true } }));
    this.patients.registerAnonymizer('reviews', async (sub) => {
      await this.prisma.review.updateMany({ where: { sub }, data: { sub: `deleted:${createHash('sha256').update(sub).digest('hex').slice(0, 10)}`, text: null } });
    });
  }

  /** KXM-RV-01: only the patient of a COMPLETED Kiorex visit; one per appointment; editable 7 days. */
  async submit(sub: string, bookingId: string, i: { rating: number; text?: string }) {
    await this.flags.assertEnabled('kiorex.reviews', { market: 'EG' });
    if (!Number.isInteger(i.rating) || i.rating < 1 || i.rating > 5) throw badRequest('INVALID_RATING', 'rating must be 1..5');
    const b = await this.booking.completedForReview(sub, bookingId);
    if (b.status !== 'COMPLETED' || !b.kiorlyAppointmentId) throw forbidden('NOT_A_COMPLETED_VISIT', 'Only completed Kiorex visits can be reviewed');
    if (await this.prisma.review.findUnique({ where: { bookingId } })) throw conflict('REVIEW_EXISTS', 'One review per completed appointment');
    const m = moderate(i.text);
    const r = await this.prisma.review.create({ data: { bookingId, sub, providerId: b.providerId, clinicId: b.clinicId, clinicianId: b.clinicianId, kiorlyAppointmentId: b.kiorlyAppointmentId, rating: i.rating, text: i.text, status: m.hidden ? 'HIDDEN' : 'VISIBLE', moderationFlags: m.flags as any, editableUntil: new Date(Date.now() + EDIT_WINDOW_MS) } });
    if (m.hidden) await this.prisma.moderationCase.create({ data: { reviewId: r.id, reason: m.flags.join(',') } });
    await this.catalog.track('review_submitted', { providerId: b.providerId });
    await this.afterChange(r);
    return this.present(r);
  }

  async edit(sub: string, id: string, i: { rating?: number; text?: string }) {
    const r = await this.prisma.review.findUnique({ where: { id } });
    if (!r || r.sub !== sub) throw notFound('REVIEW_NOT_FOUND', 'Review not found');
    if (r.editableUntil < new Date()) throw forbidden('REVIEW_EDIT_WINDOW_CLOSED', 'Reviews are editable for 7 days');
    if (i.rating !== undefined && (!Number.isInteger(i.rating) || i.rating < 1 || i.rating > 5)) throw badRequest('INVALID_RATING', 'rating must be 1..5');
    const text = i.text ?? r.text ?? undefined;
    const m = moderate(text);
    const upd = await this.prisma.review.update({ where: { id }, data: { rating: i.rating ?? r.rating, text, status: m.hidden || r.status === 'HIDDEN' ? 'HIDDEN' : 'VISIBLE', moderationFlags: m.flags as any, syncStatus: 'PENDING' } });
    if (upd.status === 'HIDDEN' && !(await this.openCase(id))) await this.prisma.moderationCase.create({ data: { reviewId: id, reason: m.flags.join(',') || 'EDITED_AFTER_MODERATION' } });
    await this.afterChange(upd);
    return this.present(upd);
  }
  private openCase(reviewId: string) { return this.prisma.moderationCase.findFirst({ where: { reviewId, status: 'OPEN' } }); }

  private async afterChange(r: Review) {
    await this.recompute(r.providerId);
    await this.outbox.enqueue(this.prisma, { type: 'kiorly.reviews_sync', target: 'KIORLY', aggregateType: 'Provider', aggregateId: r.providerId, payload: { providerId: r.providerId } });
  }

  async recompute(providerId: string) {
    const a = await this.prisma.review.aggregate({ where: { providerId, status: 'VISIBLE' }, _avg: { rating: true }, _count: true });
    await this.catalog.updateRating(providerId, Math.round((a._avg.rating ?? 0) * 100) / 100, a._count);
  }

  /** KXM-RV-03: push aggregate + recent reviews (incl. HIDDEN status) to Kiorly; idempotent upsert per appointment. */
  async syncProvider(providerId: string) {
    const rows = await this.prisma.review.findMany({ where: { providerId }, orderBy: { createdAt: 'desc' }, take: 50 });
    if (!rows.length) return;
    const vis = rows.filter((r) => r.status === 'VISIBLE');
    const a = await this.prisma.review.aggregate({ where: { providerId, status: 'VISIBLE' }, _avg: { rating: true }, _count: true });
    const { data } = await this.kiorly.syncReviews({
      clinicId: rows[0].clinicId, clinicianId: rows[0].clinicianId, averageRating: Math.round((a._avg.rating ?? 0) * 100) / 100, reviewCount: a._count,
      reviews: rows.map((r) => ({ reviewId: r.id, appointmentId: r.kiorlyAppointmentId, rating: r.rating, comment: r.status === 'VISIBLE' ? (r.text ?? undefined) : undefined, createdAt: r.createdAt.toISOString(), moderationStatus: r.status })),
    });
    const rejected = new Set((data?.rejected ?? []).map((x) => x.reviewId));
    await this.prisma.review.updateMany({ where: { id: { in: rows.filter((r) => rejected.has(r.id)).map((r) => r.id) } }, data: { syncStatus: 'REJECTED' } });
    await this.prisma.review.updateMany({ where: { id: { in: rows.filter((r) => !rejected.has(r.id)).map((r) => r.id) } }, data: { syncStatus: 'SYNCED' } });
    void vis;
  }

  present(r: Review) {
    return { id: r.id, bookingId: r.bookingId, rating: r.rating, text: r.text, status: r.status, clinicReply: r.clinicReply, editableUntil: r.editableUntil, createdAt: r.createdAt };
  }
  async mine(sub: string) { return (await this.prisma.review.findMany({ where: { sub }, orderBy: { createdAt: 'desc' } })).map((r) => this.present(r)); }

  /** KXM-PR-03: latest 20 visible reviews with clinic replies. */
  async forProvider(providerId: string) {
    const rows = await this.prisma.review.findMany({ where: { providerId, status: 'VISIBLE' }, orderBy: { createdAt: 'desc' }, take: 20 });
    const p = await this.prisma.provider.findUnique({ where: { id: providerId }, select: { ratingAvg: true, ratingCount: true } });
    return { average: p?.ratingAvg ?? 0, count: p?.ratingCount ?? 0, reviews: rows.map((r) => ({ id: r.id, rating: r.rating, text: r.text, clinicReply: r.clinicReply, createdAt: r.createdAt })) };
  }

  // ── Kiorly events ──
  async onInvitationEligible(data: Record<string, any>): Promise<string> {
    const b = data.externalReference ? await this.booking.byId(data.externalReference) : null;
    if (!b) return 'UNKNOWN_BOOKING';
    await this.engagement.scheduleReviewInvite({ id: b.id, sub: b.sub }, { doctor: '', time: b.startsAt.toISOString() }, data.occurredAt ? new Date(data.occurredAt) : new Date());
    return 'APPLIED';
  }
  async onReply(data: Record<string, any>): Promise<string> {
    const reply = data.reply ?? data.replyText ?? data.text;
    const r = await this.prisma.review.findFirst({ where: { OR: [{ id: data.reviewId ?? '-' }, { kiorlyAppointmentId: data.appointmentId ?? data.aggregateId ?? '-' }] } });
    if (!r) return 'IGNORED';
    await this.prisma.review.update({ where: { id: r.id }, data: { clinicReply: String(reply ?? '') } });
    return 'APPLIED';
  }

  // ── ops: moderation queue & complaints (KXM-OP-05) ──
  queue(status = 'OPEN') {
    return this.prisma.moderationCase.findMany({ where: { status }, orderBy: { createdAt: 'asc' }, take: 200 }).then(async (cases) => {
      const reviews = await this.prisma.review.findMany({ where: { id: { in: cases.map((c) => c.reviewId) } } });
      return cases.map((c) => ({ ...c, review: reviews.find((r) => r.id === c.reviewId) ? { ...this.present(reviews.find((r) => r.id === c.reviewId)!), providerId: reviews.find((r) => r.id === c.reviewId)!.providerId } : null }));
    });
  }
  async resolve(actor: string, caseId: string, resolution: 'RESTORED' | 'KEPT_HIDDEN') {
    const c = await this.prisma.moderationCase.findUnique({ where: { id: caseId } });
    if (!c || c.status !== 'OPEN') throw notFound('CASE_NOT_FOUND', 'No open case');
    await this.prisma.moderationCase.update({ where: { id: caseId }, data: { status: 'RESOLVED', resolution, resolvedBy: actor, resolvedAt: new Date() } });
    const r = await this.prisma.review.update({ where: { id: c.reviewId }, data: { status: resolution === 'RESTORED' ? 'VISIBLE' : 'HIDDEN', syncStatus: 'PENDING' } });
    await this.afterChange(r);
    return { ok: true, status: r.status };
  }
  /** KXMOP05: complaints about a HOME visit carry a 1 h SLA (default 24 h); only the booking owner's home bookings count. */
  async complain(sub: string, i: { category: string; body: string; bookingId?: string }) {
    const hb = i.bookingId ? await this.booking.byId(i.bookingId) : null;
    const home = !!hb && hb.sub === sub && hb.serviceLocation === 'HOME';
    const sla = home ? cfg().homeComplaintSlaMinutes * 60_000 : COMPLAINT_SLA_HOURS * 3600_000;
    return this.prisma.complaint.create({ data: { sub, bookingId: i.bookingId, category: i.category, body: i.body, slaDueAt: new Date(Date.now() + sla), homeVisit: home } });
  }
  complaints(status = 'OPEN') { return this.prisma.complaint.findMany({ where: { status }, orderBy: { slaDueAt: 'asc' }, take: 200 }).then((rows) => rows.map((c) => ({ ...c, slaBreached: c.slaDueAt < new Date(), minutesToSla: Math.round((c.slaDueAt.getTime() - Date.now()) / 60_000) }))); }
  async resolveComplaint(id: string) { await this.prisma.complaint.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date() } }); return { ok: true }; }
}
