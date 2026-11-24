import { Injectable, Logger } from '@nestjs/common';
import { cfg } from '../common/config';
import { outboundFetch } from '../common/outbound-http';
import { signKiorlyRequest } from '../common/hmac';

/** 4xx from Kiorly (a definitive answer). */
export class KiorlyHttpError extends Error {
  constructor(public readonly status: number, public readonly code: string | undefined, public readonly body: any) {
    super(`Kiorly ${status}${code ? ` ${code}` : ''}`);
  }
}
/** Network error, timeout, 5xx/429 or open circuit — outcome unknown or clinic system unavailable. */
export class KiorlyTransientError extends Error {
  constructor(message: string, public readonly kind: 'TIMEOUT' | 'NETWORK' | 'HTTP_5XX' | 'CIRCUIT_OPEN', public readonly status?: number) {
    super(message);
  }
}

export interface VisitAddressPayload { district: string; line1?: string; building?: string; floor?: string; flat?: string; landmark?: string; lat?: number; lng?: number }

interface Req { method: string; path: string; query?: Record<string, string | number | undefined>; body?: unknown; idempotencyKey?: string; clinicId?: string }

const FAIL_THRESHOLD = 5;
const OPEN_MS = 30_000;

/** HMAC client for Kiorly marketplace API with a circuit breaker per clinic (KX-09 §05). */
@Injectable()
export class KiorlyClient {
  private readonly log = new Logger('kiorly');
  private breakers = new Map<string, { fails: number; openUntil: number }>();

  isCircuitOpen(clinicId: string): boolean {
    const b = this.breakers.get(clinicId);
    return !!b && b.openUntil > Date.now();
  }
  resetCircuit(clinicId?: string) {
    clinicId ? this.breakers.delete(clinicId) : this.breakers.clear();
  }
  circuitStates() {
    return [...this.breakers.entries()].map(([clinicId, b]) => ({ clinicId, fails: b.fails, open: b.openUntil > Date.now(), openUntil: b.openUntil > Date.now() ? new Date(b.openUntil) : null }));
  }

  private record(clinicId: string | undefined, ok: boolean) {
    if (!clinicId) return;
    const b = this.breakers.get(clinicId) ?? { fails: 0, openUntil: 0 };
    if (ok) this.breakers.delete(clinicId);
    else {
      b.fails++;
      if (b.fails >= FAIL_THRESHOLD) b.openUntil = Date.now() + OPEN_MS;
      this.breakers.set(clinicId, b);
    }
  }

  async request<T = any>(r: Req): Promise<{ status: number; data: T }> {
    if (r.clinicId && this.isCircuitOpen(r.clinicId) && r.method !== 'GET') throw new KiorlyTransientError('circuit open', 'CIRCUIT_OPEN');
    const c = cfg();
    const base = c.kiorlyBaseUrl.replace(/\/$/, '');
    const qs = r.query ? '?' + new URLSearchParams(Object.entries(r.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
    const url = `${base}${r.path}${qs}`;
    const body = r.body === undefined ? undefined : JSON.stringify(r.body);
    const signed = signKiorlyRequest({ clientKey: c.kiorlyClientKey, clientSecret: c.kiorlyClientSecret, method: r.method, path: new URL(url).pathname, body });
    const headers: Record<string, string> = { ...signed.headers, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (r.idempotencyKey) headers['idempotency-key'] = r.idempotencyKey;
    let res: Response;
    try {
      res = await outboundFetch(url, { method: r.method, headers, body, signal: AbortSignal.timeout(c.kiorlyTimeoutMs) });
    } catch (e) {
      this.record(r.clinicId, false);
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new KiorlyTransientError(timeout ? 'timeout' : `network: ${(e as Error).message}`, timeout ? 'TIMEOUT' : 'NETWORK');
    }
    const text = await res.text();
    let data: any;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = { raw: text.slice(0, 200) }; }
    if (res.status >= 500 || res.status === 429) {
      // a promotion that is busy with a flood of reserves is not a sick clinic: it must not count toward the circuit breaker that guards bookings (W8 integration)
      if (!(res.status === 503 && data?.code === 'PROMOTION_RESERVE_BUSY')) this.record(r.clinicId, false);
      throw new KiorlyTransientError(`HTTP ${res.status}`, 'HTTP_5XX', res.status);
    }
    this.record(r.clinicId, true);
    if (res.status >= 400) throw new KiorlyHttpError(res.status, data?.code ?? data?.message?.code, data);
    return { status: res.status, data: data as T };
  }

  // ── typed commands (KX-09 §03) ──
  listProviders(q: { updatedSince?: string; page?: number; pageSize?: number }) {
    return this.request<{ items: any[]; page: number; pageSize: number; total: number }>({ method: 'GET', path: '/providers', query: q });
  }
  /** v2.3 (KX-09 §03): `serviceLocation=HOME&district=<code>[&lat&lng]` for home visits; 422 OUT_OF_COVERAGE when the district is not covered. */
  slots(clinicId: string, q: { clinicianId: string; typeId: string; from: string; to: string; serviceLocation?: string; district?: string; lat?: number; lng?: number }) {
    return this.request<any>({ method: 'GET', path: `/clinics/${encodeURIComponent(clinicId)}/slots`, query: q, clinicId });
  }
  /** `visitAddress` is mandatory for HOME visit types (KX-09 §03). It is sent here and nowhere else; never logged. */
  createHold(body: { clinicId: string; clinicianId: string; typeId: string; startsAt: string; endsAt?: string; externalRef: string; visitAddress?: VisitAddressPayload }) {
    return this.request<any>({ method: 'POST', path: '/holds', body, clinicId: body.clinicId });
  }
  releaseHold(clinicId: string, holdId: string) {
    return this.request<any>({ method: 'DELETE', path: `/holds/${encodeURIComponent(holdId)}`, clinicId });
  }
  createBooking(idempotencyKey: string, body: Record<string, unknown> & { clinicId: string }) {
    return this.request<any>({ method: 'POST', path: '/bookings', body, idempotencyKey, clinicId: body.clinicId });
  }
  getBooking(ref: string, clinicId?: string) {
    return this.request<any>({ method: 'GET', path: `/bookings/${encodeURIComponent(ref)}`, clinicId });
  }
  cancelBooking(ref: string, reason: string | undefined, clinicId?: string) {
    return this.request<any>({ method: 'POST', path: `/bookings/${encodeURIComponent(ref)}/cancel`, body: { reason }, clinicId });
  }
  /** P3 draft (kiorex-contracts 1.5.0): POST /marketplace/v1/care-plan-requests, idempotent on requestRef. */
  createCarePlanRequest(body: Record<string, unknown> & { clinicId: string; requestRef: string }) {
    return this.request<any>({ method: 'POST', path: '/care-plan-requests', body, clinicId: body.clinicId });
  }
  /** Link registry (contracts 1.11.0, marketplace 1.5.0): which organisation owns a link code and whether it is still active. 404 REFERRAL_LINK_NOT_FOUND for an unknown code. */
  referralLink(code: string) {
    return this.request<{ code: string; orgRef: string; clinicRef: string | null; ownerScope: string; channelKind: string; status: 'ACTIVE' | 'PAUSED' | 'REVOKED'; createdAt: string; updatedAt: string; revokedAt: string | null }>({ method: 'GET', path: `/referral-links/${encodeURIComponent(code)}` });
  }
  /** Link registry reconciliation feed: links changed since a timestamp, oldest first. */
  referralLinks(q: { updatedSince?: string; limit?: number; cursor?: string }) {
    return this.request<{ items: Array<{ code: string; orgRef: string; clinicRef: string | null; ownerScope: string; channelKind: string; status: 'ACTIVE' | 'PAUSED' | 'REVOKED'; createdAt: string; updatedAt: string; revokedAt: string | null }>; nextCursor: string | null }>({ method: 'GET', path: '/referral-links', query: q });
  }
  rescheduleBooking(ref: string, body: { startsAt: string; endsAt?: string; holdId?: string }, clinicId?: string) {
    return this.request<any>({ method: 'POST', path: `/bookings/${encodeURIComponent(ref)}/reschedule`, body, clinicId });
  }
  depositPaid(ref: string, body: { amount: number; currency: string; paymentRef: string; paidAt?: string; tender?: { cardMinor?: number; patientCreditMinor?: number; sponsoredDiscountMinor?: number } }) {
    return this.request<any>({ method: 'POST', path: `/bookings/${encodeURIComponent(ref)}/deposit-paid`, body });
  }
  depositLinkPaid(token: string, body: { amount: number; currency: string; paymentRef: string; paidAt?: string; tender?: { cardMinor?: number; patientCreditMinor?: number; sponsoredDiscountMinor?: number } }) {
    return this.request<any>({ method: 'POST', path: `/deposit-links/${encodeURIComponent(token)}/paid`, body });
  }
  recordPayout(body: { payoutRef: string; clinicId: string; amount: number; currency: string; paidAt: string; depositPaymentRefs: string[] }) {
    return this.request<any>({ method: 'POST', path: '/payouts', body });
  }
  syncReviews(body: Record<string, unknown>) {
    return this.request<{ accepted?: number; rejected?: { reviewId: string; reason: string }[] }>({ method: 'POST', path: '/reviews/aggregate', body });
  }
  syncProfileViews(body: { clinicId: string; items: { clinicianId: string; date: string; views: number }[] }) {
    return this.request<any>({ method: 'POST', path: '/analytics/profile-views', body });
  }
  /** KNLAB01 (contracts 1.6.0): relay the lab status + sanitized custody (+ secure link on release) of a Nurse-edition hand-off. Idempotent, monotonic on the clinic side. */
  pushLabOrderStatus(orderId: string, body: Record<string, unknown>, clinicId?: string) {
    return this.request<{ applied: boolean; status: string }>({ method: 'POST', path: `/lab-orders/${encodeURIComponent(orderId)}/status`, body, clinicId });
  }
  /** KX-11: mirror the patient's record-share scope consents to Kiorly (clinic patient id from the KiorlyPatientLink). */
  upsertRecordShareConsents(kiorlyPatientId: string, consents: { scope: string; granted: boolean }[], clinicId?: string) {
    return this.request<any>({ method: 'POST', path: `/patients/${encodeURIComponent(kiorlyPatientId)}/consents`, body: { consents }, clinicId });
  }
  /** Org onboarding import (contracts 1.7.0 draft): idempotent per item.idempotencyKey; the clinic tags every created row with the batch id so it can be rolled back. */
  importRecords(batchId: string, body: { orgId: string; orgName?: string; entity: string; items: unknown[] }) {
    return this.request<{ results: Array<{ sourceKey: string; targetId: string }> }>({ method: 'POST', path: `/imports/${encodeURIComponent(batchId)}/records`, body, idempotencyKey: `imp-chunk:${batchId}:${body.entity}:${(body.items as any[])[0]?.idempotencyKey ?? ''}` });
  }
  importRollback(batchId: string, body: { orgId: string }) {
    return this.request<{ removed: number }>({ method: 'POST', path: `/imports/${encodeURIComponent(batchId)}/rollback`, body });
  }
}
