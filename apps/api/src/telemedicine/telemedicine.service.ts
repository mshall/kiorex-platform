import { Inject, Injectable } from '@nestjs/common';
import { Provider, TeleSession } from '../prisma/generated/client';
import { cfg } from '../common/config';
import { conflict, notFound, unavailable } from '../common/errors';
import { newId } from '../common/ids';
import { BookingService } from '../booking/booking-public';
import { CatalogService } from '../catalog/catalog-public';
import { EngagementService } from '../engagement/engagement-public';
import { PrismaService } from '../prisma/prisma.service';
import { VIDEO, VideoAdapter, VideoToken } from './video';

const OPEN_BEFORE_MS = 15 * 60_000;
const CLOSE_AFTER_MS = 2 * 3600_000;
const TOKEN_TTL_S = 3600;

/**
 * Telemedicine orchestration (KX-03 §08, launch-locked kiorex.telemedicine): matching + video session orchestration only.
 * The clinical record stays in Kiorly Clinic: this module stores session metadata (times, status) and nothing clinical.
 * Video provider sits behind VIDEO_MODE=mock|real; the mock issues fake room tokens.
 */
@Injectable()
export class TelemedicineService {
  constructor(private readonly prisma: PrismaService, @Inject(VIDEO) private readonly video: VideoAdapter, private readonly booking: BookingService, private readonly catalog: CatalogService, private readonly engagement: EngagementService) {}

  /** Declared by Kiorly's listing when available; undeclared => capable only in mock/dev (NEEDS_HUMAN: Kiorly must publish video capability). */
  isVideoCapable(p: Provider): boolean {
    const prov = (p.raw as any)?.provider ?? {};
    const declared = [prov.telemedicine, prov.videoConsultation, ...((prov.fees ?? []) as any[]).map((f) => (f.modality === 'VIDEO' || f.isVideo === true ? true : f.isVideo === false ? false : undefined))].filter((x) => x !== undefined);
    if (declared.length) return declared.some(Boolean);
    return cfg().videoMode === 'mock';
  }

  async match(q: { specialty?: string; q?: string }) {
    const res: any = await this.catalog.search({ specialty: q.specialty, q: q.q, sort: 'earliest', pageSize: 30 });
    if (res.emergency) return { items: [], emergency: res.emergency };
    const out: any[] = [];
    for (const i of res.items ?? []) {
      const row = await this.prisma.provider.findUnique({ where: { id: i.id } });
      if (row && this.isVideoCapable(row)) out.push({ id: i.id, nameEn: i.nameEn, nameAr: i.nameAr, specialty: i.specialty, defaultTypeId: i.defaultTypeId, nextSlots: i.nextSlots });
    }
    return { items: out };
  }

  private present(s: TeleSession) {
    return { id: s.id, bookingId: s.bookingId, providerId: s.providerId, status: s.status, scheduledStartsAt: s.scheduledStartsAt.toISOString(), startedAt: s.startedAt?.toISOString() ?? null, endedAt: s.endedAt?.toISOString() ?? null, durationSec: s.durationSec, consultFeeMinor: s.consultFeeMinor, joinOpensAt: new Date(s.scheduledStartsAt.getTime() - OPEN_BEFORE_MS).toISOString() };
  }
  private async owned(sub: string, id: string) {
    const s = await this.prisma.teleSession.findUnique({ where: { id } });
    if (!s || s.sub !== sub) throw notFound('SESSION_NOT_FOUND', 'Session not found');
    return s;
  }

  /** Create the video session for the patient's own CONFIRMED booking (idempotent per booking). */
  async create(sub: string, bookingId: string) {
    const b = await this.booking.get(sub, bookingId);
    const existing = await this.prisma.teleSession.findUnique({ where: { bookingId } });
    if (existing) return this.present(existing);
    if (!['CONFIRMED', 'CHECKED_IN'].includes(b.status)) throw conflict('BOOKING_NOT_CONFIRMED', `Booking is ${b.status}`);
    const p = await this.prisma.provider.findUnique({ where: { id: b.providerId } });
    if (!p || !this.isVideoCapable(p)) throw conflict('NOT_VIDEO_CAPABLE', 'This doctor does not offer video visits');
    const id = newId('kx_ts');
    let room: { roomName: string };
    try { room = await this.video.createRoom(id); } catch { throw unavailable('VIDEO_PROVIDER_UNAVAILABLE', 'Video service unavailable', { retryable: true }); }
    const s = await this.prisma.teleSession.create({ data: { id, sub, bookingId, providerId: b.providerId, clinicId: b.clinicId, videoProvider: this.video.name, roomName: room.roomName, scheduledStartsAt: new Date(b.startsAt), consultFeeMinor: cfg().teleConsultFeeMinor } });
    return this.present(s);
  }
  async list(sub: string) { return (await this.prisma.teleSession.findMany({ where: { sub }, orderBy: { scheduledStartsAt: 'desc' }, take: 50 })).map((s) => this.present(s)); }
  async get(sub: string, id: string) { return this.present(await this.owned(sub, id)); }

  private async assertJoinable(s: TeleSession, sub?: string) {
    if (['ENDED', 'CANCELLED'].includes(s.status)) throw conflict('SESSION_CLOSED', `Session is ${s.status}`);
    const now = Date.now();
    if (now < s.scheduledStartsAt.getTime() - OPEN_BEFORE_MS) throw conflict('TOO_EARLY', 'The video room opens 15 minutes before the visit', { opensAt: new Date(s.scheduledStartsAt.getTime() - OPEN_BEFORE_MS).toISOString() });
    if (now > s.scheduledStartsAt.getTime() + CLOSE_AFTER_MS) throw conflict('SESSION_EXPIRED', 'This visit window has passed');
    if (sub) { const b = await this.booking.get(sub, s.bookingId); if (!['CONFIRMED', 'CHECKED_IN'].includes(b.status)) { await this.prisma.teleSession.update({ where: { id: s.id }, data: { status: 'CANCELLED' } }); throw conflict('BOOKING_NOT_CONFIRMED', `Booking is ${b.status}`); } }
  }

  private async mark(s: TeleSession, who: 'patient' | 'clinician') {
    const data: Record<string, unknown> = who === 'patient' ? { patientJoinedAt: s.patientJoinedAt ?? new Date() } : { clinicianJoinedAt: s.clinicianJoinedAt ?? new Date() };
    const both = (who === 'patient' ? true : !!s.patientJoinedAt) && (who === 'clinician' ? true : !!s.clinicianJoinedAt);
    data.status = both ? 'IN_PROGRESS' : 'WAITING';
    if (both && !s.startedAt) data.startedAt = new Date();
    return this.prisma.teleSession.update({ where: { id: s.id }, data });
  }

  async patientJoin(sub: string, id: string): Promise<{ session: ReturnType<TelemedicineService['present']>; video: VideoToken }> {
    const s = await this.owned(sub, id);
    await this.assertJoinable(s, sub);
    const token = await this.video.issueToken({ roomName: s.roomName, identity: `patient:${sub}`, role: 'patient', ttlSeconds: TOKEN_TTL_S });
    return { session: this.present(await this.mark(s, 'patient')), video: token };
  }

  /** Kiorly Clinic (product-key HMAC) joins by Kiorex booking id (= Kiorly externalReference). */
  async clinicianJoin(bookingId: string) {
    const s = await this.prisma.teleSession.findUnique({ where: { bookingId } });
    if (!s) throw notFound('SESSION_NOT_FOUND', 'No video session for this booking');
    await this.assertJoinable(s);
    const token = await this.video.issueToken({ roomName: s.roomName, identity: `clinician:${s.providerId}`, role: 'clinician', ttlSeconds: TOKEN_TTL_S });
    const updated = await this.mark(s, 'clinician');
    const p = await this.prisma.provider.findUnique({ where: { id: s.providerId } });
    await this.engagement.notify(s.sub, { kind: 'TELE_SESSION_READY', bookingId: s.bookingId, params: { doctor: p?.nameAr ?? p?.nameEn ?? '' }, dedupeKey: `TELE_SESSION_READY:${s.id}` });
    return { session: this.present(updated), video: token };
  }

  private async end(s: TeleSession) {
    if (s.status === 'ENDED') return this.present(s);
    if (s.status === 'CANCELLED') throw conflict('SESSION_CLOSED', 'Session is CANCELLED');
    const endedAt = new Date();
    const durationSec = s.startedAt ? Math.max(0, Math.round((endedAt.getTime() - s.startedAt.getTime()) / 1000)) : 0;
    return this.present(await this.prisma.teleSession.update({ where: { id: s.id }, data: { status: 'ENDED', endedAt, durationSec } }));
  }
  async patientEnd(sub: string, id: string) { return this.end(await this.owned(sub, id)); }
  async clinicianEnd(bookingId: string) {
    const s = await this.prisma.teleSession.findUnique({ where: { bookingId } });
    if (!s) throw notFound('SESSION_NOT_FOUND', 'No video session for this booking');
    return this.end(s);
  }
}
