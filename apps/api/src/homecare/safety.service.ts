import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SafetyAlert } from '../prisma/generated/client';
import { cfg } from '../common/config';
import { normalizeDistrict } from '../common/district';
import { conflict, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { BookingService } from '../booking/booking-public';
import { CatalogService } from '../catalog/catalog-public';
import { PayService } from '../pay/pay-public';
import { PrismaService } from '../prisma/prisma.service';
import { safetyDelivery } from './safety-delivery.adapter';

/** KXMOP12 home-visit safety console: SAFETY_ALERT_RAISED feed with the 60 s SLO, acknowledge / escalate / resolve, unsafe-abort list, escalation log. */
@Injectable()
export class SafetyService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('safety');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly booking: BookingService, private readonly catalog: CatalogService, private readonly pay: PayService) {}

  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.warn(`safety sweep failed: ${e.message}`)), 30_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async act(alertId: string, action: string, actor: string, note?: string) {
    await this.prisma.safetyAlertAction.create({ data: { alertId, action, actor, note } });
  }

  /** Webhook consumer. Semantic de-duplication on alertId (eventId de-duplication already happened). */
  async onAlertRaised(data: Record<string, any>, eventId?: string): Promise<'APPLIED' | 'IGNORED'> {
    const alertId = String(data.alertId ?? '');
    if (!alertId) return 'IGNORED';
    const deliverTo: string[] = Array.isArray(data.deliverTo) ? data.deliverTo : [];
    if (!deliverTo.includes('KIOREX_OPS')) return 'IGNORED'; // not for Kiorex ops (org safety contact only)
    if (await this.prisma.safetyAlert.findUnique({ where: { alertId } })) return 'IGNORED';
    const b = (data.externalReference ? await this.booking.byId(data.externalReference) : null) ?? (data.appointmentId ? await this.booking.byAppointmentId(data.appointmentId) : null);
    const raisedAt = data.raisedAt ? new Date(data.raisedAt) : new Date();
    const row = await this.prisma.safetyAlert.create({
      data: { id: newId('kx_sa'), alertId, eventId, bookingId: b?.id, clinicId: String(data.clinicId ?? b?.clinicId ?? ''), appointmentId: data.appointmentId ?? null, kind: String(data.kind ?? 'SOS'), district: normalizeDistrict(data.district) ?? b?.visitDistrict ?? null, deliverTo, raisedAt, deliverWithinSeconds: Number(data.deliverWithinSeconds) || cfg().safetySloSeconds },
    });
    await this.act(row.id, 'RECEIVED', 'kiorly');
    await this.deliver(row, 0);
    await this.catalog.track('home_visit_safety_alert', { code: row.kind, district: row.district, careType: b?.careType, serviceLocation: 'HOME', providerId: b?.providerId });
    return 'APPLIED';
  }

  private async deliver(a: SafetyAlert, level: number) {
    const r = await safetyDelivery().deliver({ alertId: a.alertId, kind: a.kind, district: a.district, bookingId: a.bookingId, level });
    if (r.ok) {
      if (!a.deliveredAt) await this.prisma.safetyAlert.update({ where: { id: a.id }, data: { deliveredAt: new Date(), deliveryMode: safetyDelivery().mode, deliveryRef: r.ref, deliveryError: null } });
      await this.act(a.id, 'DELIVERED', 'system', r.ref);
    } else {
      await this.prisma.safetyAlert.update({ where: { id: a.id }, data: { deliveryError: (r.error ?? 'DELIVERY_FAILED').slice(0, 200), deliveryMode: safetyDelivery().mode } });
      await this.act(a.id, 'DELIVERY_FAILED', 'system', r.error);
    }
  }

  private present(a: SafetyAlert & { actions?: { action: string; actor: string; note: string | null; createdAt: Date }[] }, ctx?: { providerName?: string | null; clinicPhone?: string | null }) {
    const now = Date.now();
    const deadline = new Date(a.raisedAt.getTime() + a.deliverWithinSeconds * 1000);
    const lag = a.deliveredAt ? Math.round((a.deliveredAt.getTime() - a.raisedAt.getTime()) / 100) / 10 : null;
    const open = a.status === 'RAISED' || a.status === 'ESCALATED' || a.status === 'ACKNOWLEDGED';
    return {
      id: a.id, alertId: a.alertId, kind: a.kind, status: a.status, bookingId: a.bookingId, clinicId: a.clinicId, district: a.district, raisedAt: a.raisedAt, receivedAt: a.receivedAt,
      slo: { seconds: a.deliverWithinSeconds, deadlineAt: deadline, deliveredAt: a.deliveredAt, deliveryLagSeconds: lag, met: lag !== null ? lag <= a.deliverWithinSeconds : null, breached: a.deliveredAt ? lag! > a.deliverWithinSeconds : now > deadline.getTime(), receiveLagSeconds: Math.round((a.receivedAt.getTime() - a.raisedAt.getTime()) / 100) / 10 },
      delivery: { mode: a.deliveryMode, ref: a.deliveryRef, error: a.deliveryError },
      acknowledgedAt: a.acknowledgedAt, acknowledgedBy: a.acknowledgedBy, ackLagSeconds: a.acknowledgedAt ? Math.round((a.acknowledgedAt.getTime() - a.raisedAt.getTime()) / 1000) : null,
      escalatedAt: a.escalatedAt, escalationLevel: a.escalationLevel, resolvedAt: a.resolvedAt,
      needsEscalation: open && !a.acknowledgedAt && now - a.raisedAt.getTime() > cfg().safetyAckEscalateMinutes * 60_000,
      ageSeconds: Math.round((now - a.raisedAt.getTime()) / 1000),
      providerName: ctx?.providerName ?? null, clinicPhone: ctx?.clinicPhone ?? null,
      actions: a.actions?.map((x) => ({ action: x.action, actor: x.actor, note: x.note, at: x.createdAt })) ?? [],
    };
  }

  private async withCtx(rows: SafetyAlert[], withActions = false) {
    const out = [];
    for (const a of rows) {
      const b = a.bookingId ? await this.booking.byId(a.bookingId) : null;
      const p = b ? await this.booking.providerOf(b) : null;
      const actions = withActions ? await this.prisma.safetyAlertAction.findMany({ where: { alertId: a.id }, orderBy: { createdAt: 'asc' } }) : undefined;
      out.push(this.present({ ...a, actions }, { providerName: p?.nameEn ?? p?.clinicNameEn ?? null, clinicPhone: (p?.raw as any)?.clinic?.phone ?? null }));
    }
    return out;
  }

  async list(q: { status?: string; kind?: string; limit?: number }) {
    const rows = await this.prisma.safetyAlert.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) }, orderBy: { raisedAt: 'desc' }, take: Math.min(q.limit ?? 100, 300) });
    return { items: await this.withCtx(rows) };
  }
  async get(id: string) {
    const a = await this.prisma.safetyAlert.findUnique({ where: { id } });
    if (!a) throw notFound('ALERT_NOT_FOUND', 'Safety alert not found');
    return (await this.withCtx([a], true))[0];
  }

  async acknowledge(actor: string, id: string, note?: string) {
    const a = await this.prisma.safetyAlert.findUnique({ where: { id } });
    if (!a) throw notFound('ALERT_NOT_FOUND', 'Safety alert not found');
    if (a.status === 'RESOLVED') throw conflict('ALERT_RESOLVED', 'Alert is already resolved');
    if (a.acknowledgedAt) return this.get(id); // idempotent
    await this.prisma.safetyAlert.update({ where: { id }, data: { acknowledgedAt: new Date(), acknowledgedBy: actor, status: a.status === 'ESCALATED' ? 'ESCALATED' : 'ACKNOWLEDGED' } });
    await this.act(id, 'ACKNOWLEDGE', actor, note);
    return this.get(id);
  }

  async escalate(actor: string, id: string, note?: string, auto = false) {
    const a = await this.prisma.safetyAlert.findUnique({ where: { id } });
    if (!a) throw notFound('ALERT_NOT_FOUND', 'Safety alert not found');
    if (a.status === 'RESOLVED') throw conflict('ALERT_RESOLVED', 'Alert is already resolved');
    const level = a.escalationLevel + 1;
    const upd = await this.prisma.safetyAlert.update({ where: { id }, data: { status: 'ESCALATED', escalatedAt: new Date(), escalatedBy: actor, escalationLevel: level } });
    await this.act(id, auto ? 'AUTO_ESCALATE' : 'ESCALATE', actor, note);
    await this.deliver(upd, level); // page the on-call again at the new level
    return this.get(id);
  }

  async resolve(actor: string, id: string, note?: string) {
    const a = await this.prisma.safetyAlert.findUnique({ where: { id } });
    if (!a) throw notFound('ALERT_NOT_FOUND', 'Safety alert not found');
    if (a.status === 'RESOLVED') return this.get(id);
    await this.prisma.safetyAlert.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: actor, acknowledgedAt: a.acknowledgedAt ?? new Date(), acknowledgedBy: a.acknowledgedBy ?? actor } });
    await this.act(id, 'RESOLVE', actor, note);
    return this.get(id);
  }

  /** Retry undelivered alerts; auto-escalate alerts nobody acknowledged within SAFETY_ACK_ESCALATE_MINUTES (KX-09 §08). */
  async sweep() {
    const open = await this.prisma.safetyAlert.findMany({ where: { status: { in: ['RAISED', 'ESCALATED'] }, acknowledgedAt: null } });
    let retried = 0, escalated = 0;
    for (const a of open) {
      if (!a.deliveredAt) { await this.deliver(a, a.escalationLevel); retried++; }
      if (a.escalationLevel === 0 && Date.now() - a.raisedAt.getTime() > cfg().safetyAckEscalateMinutes * 60_000) { await this.escalate('system', a.id, 'no acknowledgement in time', true); escalated++; }
    }
    return { retried, escalated };
  }

  async summary() {
    const since = new Date(Date.now() - 30 * 86400_000);
    const rows = await this.prisma.safetyAlert.findMany({ where: { raisedAt: { gte: since } } });
    const lags = rows.filter((r) => r.deliveredAt).map((r) => (r.deliveredAt!.getTime() - r.raisedAt.getTime()) / 1000).sort((x, y) => x - y);
    const aborts = await this.booking.opsUnsafeAborts(500);
    const held = await this.pay.heldForReview();
    return {
      windowDays: 30, total: rows.length,
      open: rows.filter((r) => r.status !== 'RESOLVED').length, unacknowledged: rows.filter((r) => !r.acknowledgedAt && r.status !== 'RESOLVED').length,
      sloBreaches: rows.filter((r) => (r.deliveredAt ? (r.deliveredAt.getTime() - r.raisedAt.getTime()) / 1000 > r.deliverWithinSeconds : Date.now() - r.raisedAt.getTime() > r.deliverWithinSeconds * 1000)).length,
      medianDeliverySeconds: lags.length ? lags[Math.floor(lags.length / 2)] : null, p95DeliverySeconds: lags.length ? lags[Math.min(lags.length - 1, Math.floor(lags.length * 0.95))] : null,
      byKind: ['TIMER_EXPIRED', 'SOS', 'UNSAFE_ABORT'].map((kind) => ({ kind, count: rows.filter((r) => r.kind === kind).length })),
      unsafeAborts: aborts.length, depositsHeldForReview: held.length, deliveryMode: safetyDelivery().mode, sloSeconds: cfg().safetySloSeconds, ackEscalateMinutes: cfg().safetyAckEscalateMinutes,
    };
  }

  async escalationLog(limit = 100) {
    const rows = await this.prisma.safetyAlertAction.findMany({ where: { action: { in: ['ESCALATE', 'AUTO_ESCALATE'] } }, orderBy: { createdAt: 'desc' }, take: limit, include: { alert: true } });
    return rows.map((r) => ({ alertId: r.alert.alertId, id: r.alert.id, kind: r.alert.kind, district: r.alert.district, action: r.action, actor: r.actor, note: r.note, at: r.createdAt, level: r.alert.escalationLevel }));
  }
  unsafeAborts() { return this.booking.opsUnsafeAborts(); }
}
