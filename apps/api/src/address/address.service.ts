import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PatientAddress } from '../prisma/generated/client';
import { cfg } from '../common/config';
import { decryptField, encryptField } from '../common/crypto';
import { addressForLog, normalizeDistrict } from '../common/district';
import { badRequest, conflict, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { AuthUser } from '../common/auth';
import { PatientService } from '../patient/patient-public';
import { PrismaService } from '../prisma/prisma.service';
import { mapsAdapter } from './maps.adapter';

export interface AddressInput {
  label: string; governorate: string; district: string; street: string;
  building?: string; floor?: string; flat?: string; landmark?: string; lat?: number; lng?: number; makeDefault?: boolean;
}
/** The encrypted part (KXMHV01): everything that identifies a doorstep. */
export interface AddressLines { street: string; building?: string; floor?: string; flat?: string; landmark?: string; lat?: number; lng?: number; pinSource?: 'USER' | 'GEOCODED' }
/** Shape sent to Kiorly on the hold (KX-09 §03 visitAddress). Built at call time, never stored or logged in this form. */
export interface VisitAddress { district: string; line1: string; building?: string; floor?: string; flat?: string; landmark?: string; lat?: number; lng?: number }

export const MAX_ADDRESSES = 10;

/**
 * Patient address book (KXMHV01) and the per-booking address snapshot (KXMHV03/10).
 * - Doorstep fields are AES-256-GCM encrypted at rest (FIELD_ENCRYPTION_KEY); governorate + district stay plain (district-level only everywhere else).
 * - NOTHING here is ever logged with an address: log lines/audit rows use addressForLog() (district only).
 * - Addresses live under the patient and on the booking snapshot, NEVER on the provider projection.
 */
@Injectable()
export class AddressService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('address');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly patients: PatientService) {}

  onModuleInit() {
    this.patients.registerExport('addresses', async (sub) =>
      // exports are persisted in DataRequest.result: only district-level data goes in (the street lines are encrypted at rest and not re-materialised there)
      (await this.prisma.patientAddress.findMany({ where: { sub, deletedAt: null } })).map((a) => ({ id: a.id, label: a.label, governorate: a.governorate, district: a.district, confirmed: !!a.confirmedAt, doorstepLines: 'encrypted: available in-app' })));
    this.patients.registerAnonymizer('addresses', async (sub) => {
      const wiped = encryptField('{}');
      await this.prisma.patientAddress.updateMany({ where: { sub }, data: { addressEnc: wiped, deletedAt: new Date(), label: 'deleted' } });
      await this.prisma.bookingVisitAddress.updateMany({ where: { sub }, data: { addressEnc: null, maskedAt: new Date() } });
    });
    if (cfg().jobsEnabled) {
      this.timer = setInterval(() => void this.maskExpired().catch((e) => this.log.warn(`address mask sweep failed: ${e.message}`)), 15 * 60_000);
      this.timer.unref();
    }
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ───────────── address book ─────────────

  private lines(a: PatientAddress): AddressLines { return JSON.parse(decryptField(a.addressEnc)) as AddressLines; }

  present(a: PatientAddress) {
    const l = this.lines(a);
    return {
      id: a.id, label: a.label, governorate: a.governorate, district: a.district,
      street: l.street ?? null, building: l.building ?? null, floor: l.floor ?? null, flat: l.flat ?? null, landmark: l.landmark ?? null,
      lat: l.lat ?? null, lng: l.lng ?? null, hasPin: l.lat !== undefined && l.lng !== undefined, pinSource: l.pinSource ?? null,
      confirmed: !!a.confirmedAt, confirmedAt: a.confirmedAt, isDefault: a.isDefault, createdAt: a.createdAt,
      summary: `${a.label} · ${a.district} · ${a.governorate}`, // masked summary (no doorstep lines): safe for lists shown to others
    };
  }

  async list(sub: string) {
    const rows = await this.prisma.patientAddress.findMany({ where: { sub, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    return rows.map((r) => this.present(r));
  }

  private async owned(sub: string, id: string): Promise<PatientAddress> {
    const a = await this.prisma.patientAddress.findFirst({ where: { id, sub, deletedAt: null } });
    if (!a) throw notFound('ADDRESS_NOT_FOUND', 'Address not found');
    return a;
  }

  private validate(i: Partial<AddressInput>, partial: boolean) {
    if (!partial || i.district !== undefined) {
      if (!normalizeDistrict(i.district)) throw badRequest('INVALID_DISTRICT', 'district must be a district code from GET /home/districts (e.g. nasr-city), not an address line');
    }
    if (!partial && !i.street?.trim()) throw badRequest('STREET_REQUIRED', 'street is required');
    if ((i.lat === undefined) !== (i.lng === undefined)) throw badRequest('INVALID_PIN', 'lat and lng must be given together');
  }

  async create(u: AuthUser, i: AddressInput) {
    await this.patients.ensureProfile(u);
    this.validate(i, false);
    const count = await this.prisma.patientAddress.count({ where: { sub: u.sub, deletedAt: null } });
    if (count >= MAX_ADDRESSES) throw conflict('ADDRESS_LIMIT', `At most ${MAX_ADDRESSES} saved addresses`);
    const district = normalizeDistrict(i.district)!;
    const lines: AddressLines = { street: i.street.trim(), building: i.building?.trim() || undefined, floor: i.floor?.trim() || undefined, flat: i.flat?.trim() || undefined, landmark: i.landmark?.trim() || undefined };
    if (i.lat !== undefined && i.lng !== undefined) { lines.lat = i.lat; lines.lng = i.lng; lines.pinSource = 'USER'; }
    else {
      try { const g = await mapsAdapter().geocode({ governorate: i.governorate, district, street: i.street }); lines.lat = g.lat; lines.lng = g.lng; lines.pinSource = 'GEOCODED'; } catch { /* maps are best-effort: an address without a pin is valid */ }
    }
    const makeDefault = i.makeDefault || count === 0;
    const row = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) await tx.patientAddress.updateMany({ where: { sub: u.sub, isDefault: true }, data: { isDefault: false } });
      return tx.patientAddress.create({ data: { id: newId('kx_ad'), sub: u.sub, label: i.label.trim(), governorate: i.governorate.trim(), district, addressEnc: encryptField(JSON.stringify(lines)), isDefault: makeDefault } });
    });
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'address.created', resource: 'PatientAddress', resourceId: row.id, metadata: addressForLog(row) } });
    return this.present(row);
  }

  async update(u: AuthUser, id: string, i: Partial<AddressInput>) {
    const a = await this.owned(u.sub, id);
    this.validate(i, true);
    const cur = this.lines(a);
    const next: AddressLines = { ...cur };
    for (const k of ['street', 'building', 'floor', 'flat', 'landmark'] as const) if (i[k] !== undefined) (next as any)[k] = i[k]?.trim() || undefined;
    if (i.lat !== undefined && i.lng !== undefined) { next.lat = i.lat; next.lng = i.lng; next.pinSource = 'USER'; }
    const district = i.district !== undefined ? normalizeDistrict(i.district)! : a.district;
    const moved = district !== a.district || (i.street !== undefined && i.street.trim() !== cur.street);
    const row = await this.prisma.$transaction(async (tx) => {
      if (i.makeDefault) await tx.patientAddress.updateMany({ where: { sub: u.sub, isDefault: true }, data: { isDefault: false } });
      return tx.patientAddress.update({ where: { id }, data: { ...(i.label !== undefined ? { label: i.label.trim() } : {}), ...(i.governorate !== undefined ? { governorate: i.governorate.trim() } : {}), district, addressEnc: encryptField(JSON.stringify(next)), ...(i.makeDefault ? { isDefault: true } : {}), ...(moved ? { confirmedAt: null, confirmedPhoneLast4: null } : {}) } });
    });
    return this.present(row);
  }

  async remove(sub: string, id: string) {
    const a = await this.owned(sub, id);
    await this.prisma.patientAddress.update({ where: { id: a.id }, data: { deletedAt: new Date(), addressEnc: encryptField('{}'), isDefault: false } });
    return { ok: true };
  }

  /** KXMHV01: confirm an address with the OTP-verified phone (the Passport access token's phone_number) before the first home booking. */
  async confirm(u: AuthUser, id: string) {
    const a = await this.owned(u.sub, id);
    const profile = await this.patients.profileBySub(u.sub);
    if (!u.phone) throw conflict('PHONE_NOT_VERIFIED', 'A phone verified with a one-time code is required to confirm an address');
    if (profile?.phone && profile.phone !== u.phone) throw conflict('PHONE_MISMATCH', 'The verified phone does not match your profile phone');
    const row = await this.prisma.patientAddress.update({ where: { id: a.id }, data: { confirmedAt: new Date(), confirmedPhoneLast4: u.phone.slice(-4) } });
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'address.confirmed', resource: 'PatientAddress', resourceId: row.id, metadata: addressForLog(row) } });
    return this.present(row);
  }

  // ───────────── booking integration (KXMHV03/04) ─────────────

  /** Address picked for a home booking: owner check + the "one confirmed address before the first home booking" rule. */
  async resolveForBooking(sub: string, addressId: string) {
    const a = await this.owned(sub, addressId);
    if (!a.confirmedAt) {
      const anyConfirmed = await this.prisma.patientAddress.count({ where: { sub, deletedAt: null, confirmedAt: { not: null } } });
      if (!anyConfirmed) throw conflict('ADDRESS_NOT_CONFIRMED', 'Confirm an address with your verified phone before your first home booking', { addressId: a.id });
    }
    const l = this.lines(a);
    const visit: VisitAddress = { district: a.district, line1: l.street, building: l.building, floor: l.floor, flat: l.flat, landmark: l.landmark, lat: l.lat, lng: l.lng };
    return { row: a, visit };
  }

  /** Raw row for a snapshot (owner only; null if deleted). */
  async rowFor(sub: string, id: string) { return this.prisma.patientAddress.findFirst({ where: { id, sub, deletedAt: null } }); }

  /** Freeze the address a booking was made with (copy of the ciphertext). */
  async snapshot(bookingId: string, sub: string, a: PatientAddress) {
    await this.prisma.bookingVisitAddress.upsert({ where: { bookingId }, create: { bookingId, sub, governorate: a.governorate, district: a.district, addressEnc: a.addressEnc }, update: {} });
  }

  /** KXMHV10: the snapshot is hidden 24 h after the visit ended. Called when a home booking reaches a terminal state. */
  async scheduleMask(bookingId: string, endedAt = new Date()) {
    await this.prisma.bookingVisitAddress.updateMany({ where: { bookingId, maskAfter: null }, data: { maskAfter: new Date(endedAt.getTime() + cfg().addressMaskHours * 3600_000) } });
  }

  async maskExpired(now = new Date()): Promise<number> {
    const r = await this.prisma.bookingVisitAddress.updateMany({ where: { maskAfter: { lte: now }, maskedAt: null }, data: { addressEnc: null, maskedAt: now } });
    return r.count;
  }

  /** Booking view: the owner sees the full address until it is masked; after that, district only (also lazily, if the sweep has not run yet). */
  async forBooking(bookingId: string) {
    const v = await this.prisma.bookingVisitAddress.findUnique({ where: { bookingId } });
    if (!v) return null;
    const expired = !!v.maskAfter && v.maskAfter <= new Date();
    const masked = !!v.maskedAt || expired || !v.addressEnc;
    if (masked) return { district: v.district, governorate: v.governorate, masked: true, maskedAt: v.maskedAt ?? v.maskAfter ?? null, address: null };
    const l = JSON.parse(decryptField(v.addressEnc!)) as AddressLines;
    return { district: v.district, governorate: v.governorate, masked: false, maskedAt: null, address: { street: l.street, building: l.building ?? null, floor: l.floor ?? null, flat: l.flat ?? null, landmark: l.landmark ?? null } };
  }
}
