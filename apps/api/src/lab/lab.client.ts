import { Injectable } from '@nestjs/common';
import { cfg } from '../common/config';
import { partnerRequest } from '../common/partner-http';

/**
 * Kiorly Lab operational API client — DRAFT CONTRACT (Kiorly Lab is not built; KX-07 KLORD02, KLCRIT02/03). Same HMAC scheme.
 * Documented in Docs/VERTICALS.md. Results return only as the LabResultReleased event (signed report version + secure link).
 *
 *   GET  /tests?q                         test catalogue (labs that opted into Kiorex bookings)
 *   POST /tests/quote                     authoritative prices for labId + test codes
 *   GET  /labs/{labId}/slots              collection slots: collectionType=HOME|WALK_IN, from, to, tests
 *   POST /orders            Idempotency-Key = Kiorex booking id   create order + slot
 *   POST /orders/{orderId}/cancel
 */
@Injectable()
export class LabClient {
  private conn() { const c = cfg(); return { baseUrl: c.labBaseUrl, clientKey: c.labClientKey, clientSecret: c.labClientSecret, timeoutMs: c.partnerTimeoutMs }; }
  tests(q: { q?: string; labId?: string }) { return partnerRequest<{ items: LabTestDto[] }>(this.conn(), { method: 'GET', path: '/tests', query: q }); }
  quote(body: { labId: string; testCodes: string[]; collectionType: string }) { return partnerRequest<{ tests: { code: string; name: string; priceMinor: number }[]; collectionFeeMinor: number }>(this.conn(), { method: 'POST', path: '/tests/quote', body }); }
  slots(labId: string, q: { collectionType: string; from: string; to: string; tests?: string }) { return partnerRequest<{ slots: { startsAt: string; endsAt: string }[] }>(this.conn(), { method: 'GET', path: `/labs/${encodeURIComponent(labId)}/slots`, query: q }); }
  createOrder(key: string, body: Record<string, unknown>) { return partnerRequest<{ orderId: string; status: 'ACCEPTED' | 'REJECTED'; reason?: string }>(this.conn(), { method: 'POST', path: '/orders', body, idempotencyKey: key }); }
  cancelOrder(orderId: string, reason: string) { return partnerRequest<{ status: string }>(this.conn(), { method: 'POST', path: `/orders/${encodeURIComponent(orderId)}/cancel`, body: { reason } }); }
}
export interface LabTestDto { labId: string; labName: string; code: string; name: string; priceMinor: number; sampleType?: string; homeCollection: boolean; preparation?: string }
