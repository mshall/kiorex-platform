import { Injectable } from '@nestjs/common';
import { KiorlyClient, KiorlyHttpError, KiorlyTransientError } from '../../kiorly/kiorly-public';

export type ReserveRefusalCode = 'BUDGET_EXHAUSTED' | 'NOT_ELIGIBLE' | 'PAUSED' | 'WALLET_INSUFFICIENT' | 'LIMIT_REACHED';
export type ReserveOutcome = { ok: true; reservationRef: string; expiresAt: string } | { ok: false; reason: ReserveRefusalCode | 'UNAVAILABLE' };
export interface ReserveRequest { promotionId: string; clinicId: string; version: number; bookingRef: string; patientRef: string; careType: 'IN_CLINIC' | 'VIDEO' | 'HOME_VISIT'; amountMinor: number; currency: string; idempotencyKey: string }
export const PROMOTION_RESERVATION_CLIENT = Symbol('PROMOTION_RESERVATION_CLIENT');

/** What Kiorex asks of the Clinic (signed marketplace commands). The Clinic is the system of record of the budget and the wallet; Kiorex only asks and records the answer. */
export interface PromotionReservationClient {
  reserve(r: ReserveRequest): Promise<ReserveOutcome>;
  release(r: { promotionId: string; clinicId: string; reservationRef: string; idempotencyKey: string; reason?: string }): Promise<boolean>;
  reviewDecision(r: { promotionId: string; clinicId: string; version: number; reviewKind: 'CONTENT' | 'SCOPE' | 'HIGH_VALUE'; decision: 'APPROVED' | 'REJECTED' | 'NEEDS_CHANGES'; note?: string; decidedBy: string }): Promise<'APPLIED' | 'UNAVAILABLE' | { refused: string }>;
}

const REASONS = new Set<string>(['BUDGET_EXHAUSTED', 'NOT_ELIGIBLE', 'PAUSED', 'WALLET_INSUFFICIENT', 'LIMIT_REACHED']);

@Injectable()
export class KiorlyPromotionReservationClient implements PromotionReservationClient {
  constructor(private readonly kiorly: KiorlyClient) {}
  async reserve(r: ReserveRequest): Promise<ReserveOutcome> {
    try {
      const { data } = await this.kiorly.request<{ reservationRef: string; expiresAt: string }>({ method: 'POST', path: `/promotions/${encodeURIComponent(r.promotionId)}/reserve`, clinicId: r.clinicId,
        body: { version: r.version, bookingRef: r.bookingRef, patientRef: r.patientRef, careType: r.careType, amountMinor: r.amountMinor, currency: r.currency, idempotencyKey: r.idempotencyKey } });
      return typeof data?.reservationRef === 'string' ? { ok: true, reservationRef: data.reservationRef, expiresAt: data.expiresAt } : { ok: false, reason: 'UNAVAILABLE' };
    } catch (e) {
      if (e instanceof KiorlyHttpError) { const code = e.code ?? e.body?.code ?? e.body?.message?.code; return { ok: false, reason: REASONS.has(code) ? (code as ReserveRefusalCode) : 'NOT_ELIGIBLE' }; }
      if (e instanceof KiorlyTransientError) return { ok: false, reason: 'UNAVAILABLE' };
      throw e;
    }
  }
  async release(r: { promotionId: string; clinicId: string; reservationRef: string; idempotencyKey: string; reason?: string }): Promise<boolean> {
    try { await this.kiorly.request({ method: 'POST', path: `/promotions/${encodeURIComponent(r.promotionId)}/release`, clinicId: r.clinicId, body: { reservationRef: r.reservationRef, idempotencyKey: r.idempotencyKey, ...(r.reason ? { reason: r.reason } : {}) } }); return true; }
    catch (e) { if (e instanceof KiorlyHttpError || e instanceof KiorlyTransientError) return false; throw e; }
  }
  async reviewDecision(r: Parameters<PromotionReservationClient['reviewDecision']>[0]) {
    try { await this.kiorly.request({ method: 'POST', path: `/promotions/${encodeURIComponent(r.promotionId)}/review-decision`, clinicId: r.clinicId, body: { version: r.version, reviewKind: r.reviewKind, decision: r.decision, ...(r.note ? { note: r.note } : {}), decidedBy: r.decidedBy, decidedAt: new Date().toISOString() } }); return 'APPLIED' as const; }
    catch (e) { if (e instanceof KiorlyHttpError) return { refused: e.code ?? e.body?.message?.code ?? `HTTP_${e.status}` }; if (e instanceof KiorlyTransientError) return 'UNAVAILABLE' as const; throw e; }
  }
}
