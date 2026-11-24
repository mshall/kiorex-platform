import { Inject, Injectable, Optional } from '@nestjs/common';
import { PRODUCT_GROWTH, type ProductGrowthPort } from '../growth/growth-ports-public';
import { CarePlanBooking } from '../prisma/generated/client';
import { encryptField } from '../common/crypto';
import { badRequest, conflict, notFound, unavailable } from '../common/errors';
import { newId } from '../common/ids';
import { AddressService } from '../address/address-public';
import { BookingService } from '../booking/booking-public';
import { CatalogService } from '../catalog/catalog-public';
import { FlagsService } from '../control-plane/control-plane-public';
import { EngagementService } from '../engagement/engagement-public';
import { KiorlyClient, KiorlyHttpError, KiorlyTransientError } from '../kiorly/kiorly-public';
import { PatientService } from '../patient/patient-public';
import { PrismaService } from '../prisma/prisma.service';

/**
 * KXMHV08 (P3, DRAFT): a care plan booked from Kiorex = ONE booking with a schedule; each visit is a normal booking with its own status.
 * Behind nurse.care_plans (launch-locked, gate GKN1) AND kiorex.home_visits: OFF/awaiting-gate => 403 FEATURE_DISABLED.
 * Kiorly contract: POST /marketplace/v1/care-plan-requests (idempotent on requestRef = plan id), events CARE_PLAN_CONFIRMED / _ENDED.
 */
@Injectable()
export class CarePlanService {
  constructor(private readonly prisma: PrismaService, private readonly kiorly: KiorlyClient, private readonly flags: FlagsService, private readonly catalog: CatalogService, private readonly addresses: AddressService, private readonly patients: PatientService, private readonly booking: BookingService, private readonly engagement: EngagementService, @Optional() @Inject(PRODUCT_GROWTH) private readonly growth?: ProductGrowthPort) {} // GRW-P4-B2/P4-A: product decision (optional: absent = exactly as before)

  async request(sub: string, i: { providerId: string; typeId?: string; addressId: string; preferredStartDate?: string; notes?: string }, via: { continuityId?: string | null } = {}) {
    await this.flags.assertEnabled('kiorex.home_visits', { market: 'EG' });
    await this.flags.assertEnabled('nurse.care_plans', { market: 'EG' });
    const p = await this.catalog.getRow(i.providerId);
    if (p.status !== 'LIVE') throw conflict('LISTING_NOT_LIVE', 'Unverified or paused listings are not bookable');
    if (!this.catalog.isHomeEnabled(p)) throw conflict('HOME_NOT_OFFERED', 'This provider does not offer home visits');
    const { row, visit } = await this.addresses.resolveForBooking(sub, i.addressId);
    if (!this.catalog.coversDistrict(p, row.district)) throw await this.catalog.outOfCoverage(p, row.district);
    const identity = await this.patients.bookingIdentity(sub);
    const id = newId('kx_cp');
    const plan = await this.prisma.carePlanBooking.create({ data: { id, sub, providerId: p.id, clinicId: p.clinicId, typeId: i.typeId, visitDistrict: row.district, visitAddressId: row.id, preferredStartDate: i.preferredStartDate ? new Date(i.preferredStartDate) : null, notesEnc: i.notes ? encryptField(i.notes) : null } });
    // GRW-P4-B2 / GRW-P4-A: one decision after the care-plan booking exists, never blocking it (the port swallows and counts failures). The Nurse edition has no partner `acquisition` block in the contract yet: the decision is Kiorex-side only.
    await this.growth?.decide({ product: 'NURSE', factKind: 'CARE_PLAN_BOOKING', factId: id, sub, orgRef: p.tenantId ?? null, createdAt: plan.createdAt, continuity: { entryId: via.continuityId ?? null } });
    try {
      await this.kiorly.createCarePlanRequest({ requestRef: id, clinicId: p.clinicId, clinicianId: p.clinicianId, typeId: i.typeId, preferredStartDate: i.preferredStartDate, notes: i.notes, visitAddress: visit, patient: { phone: identity.phone, firstNameEn: identity.firstNameEn, lastNameEn: identity.lastNameEn } });
    } catch (e) {
      await this.prisma.carePlanBooking.update({ where: { id }, data: { status: 'REJECTED', endedReason: e instanceof KiorlyHttpError ? e.code ?? `KIORLY_${e.status}` : 'CLINIC_SYSTEM_BUSY' } });
      if (e instanceof KiorlyHttpError && e.body?.code === 'OUT_OF_COVERAGE') throw await this.catalog.outOfCoverage(p, row.district);
      if (e instanceof KiorlyHttpError) throw badRequest(e.code ?? 'CARE_PLAN_REJECTED', 'The provider cannot accept this care plan request');
      if (e instanceof KiorlyTransientError) throw unavailable('CLINIC_SYSTEM_BUSY', 'Clinic system busy, try again shortly', { retryable: true });
      throw e;
    }
    return this.view(plan);
  }

  async view(plan: CarePlanBooking) {
    const visits = await this.prisma.bookingIntent.findMany({ where: { carePlanId: plan.id }, orderBy: { startsAt: 'asc' } });
    return {
      id: plan.id, providerId: plan.providerId, status: plan.status, district: plan.visitDistrict, confirmedAt: plan.confirmedAt, endedAt: plan.endedAt, endedReason: plan.endedReason, createdAt: plan.createdAt,
      visits: visits.map((v) => ({ bookingId: v.id, startsAt: v.startsAt, endsAt: v.endsAt, status: v.status, homeState: v.homeState })),
      completedVisits: visits.filter((v) => v.status === 'COMPLETED').length,
    };
  }
  async list(sub: string) { return Promise.all((await this.prisma.carePlanBooking.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 50 })).map((p) => this.view(p))); }
  async get(sub: string, id: string) {
    const p = await this.prisma.carePlanBooking.findFirst({ where: { id, sub } });
    if (!p) throw notFound('CARE_PLAN_NOT_FOUND', 'Care plan not found');
    return this.view(p);
  }

  async onConfirmed(data: Record<string, any>): Promise<'APPLIED' | 'IGNORED'> {
    const plan = data.requestRef ? await this.prisma.carePlanBooking.findUnique({ where: { id: String(data.requestRef) } }) : null;
    if (!plan || plan.status === 'ENDED') return 'IGNORED';
    await this.prisma.carePlanBooking.update({ where: { id: plan.id }, data: { status: 'CONFIRMED', kiorlyCarePlanId: data.carePlanId, confirmedAt: new Date() } });
    for (const v of data.visits ?? []) {
      const startsAt = new Date(v.startsAt);
      await this.booking.createConfirmedVisit({ sub: plan.sub, planId: plan.id, providerId: plan.providerId, typeId: plan.typeId ?? '', appointmentId: v.appointmentId, startsAt, endsAt: v.endsAt ? new Date(v.endsAt) : new Date(startsAt.getTime() + 45 * 60_000), district: plan.visitDistrict, addressId: plan.visitAddressId });
    }
    const p = await this.catalog.getRow(plan.providerId);
    await this.engagement.notify(plan.sub, { kind: 'CARE_PLAN_CONFIRMED', params: { doctor: p.nameAr ?? p.nameEn ?? '', count: (data.visits ?? []).length }, dedupeKey: `care-plan-confirmed:${plan.id}` }).catch(() => undefined);
    return 'APPLIED';
  }

  async onEnded(data: Record<string, any>): Promise<'APPLIED' | 'IGNORED'> {
    const plan = (data.requestRef ? await this.prisma.carePlanBooking.findUnique({ where: { id: String(data.requestRef) } }) : null) ?? (data.carePlanId ? await this.prisma.carePlanBooking.findFirst({ where: { kiorlyCarePlanId: String(data.carePlanId) } }) : null);
    if (!plan || plan.status === 'ENDED') return 'IGNORED';
    await this.prisma.carePlanBooking.update({ where: { id: plan.id }, data: { status: 'ENDED', endedAt: new Date(), endedReason: data.reason } });
    for (const appt of data.cancelledAppointmentIds ?? []) await this.booking.applyEvent({ type: 'CANCELLED_BY_CLINIC', data: { appointmentId: appt, cancelledBy: 'CLINIC', depositRefundable: true } });
    // KXMHV08: review at plan end (the first completed visit already got its invitation)
    const last = await this.prisma.bookingIntent.findFirst({ where: { carePlanId: plan.id, status: 'COMPLETED' }, orderBy: { startsAt: 'desc' } });
    if (last) await this.engagement.scheduleReviewInvite({ id: last.id, sub: last.sub }, { doctor: '', time: last.startsAt.toISOString() }).catch(() => undefined);
    return 'APPLIED';
  }
}
