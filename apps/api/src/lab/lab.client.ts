import { Injectable } from '@nestjs/common';
import { partnerRequest } from '../common/partner-http';
import { PartnerRegistry } from '../partners/partners-public';

/**
 * Kiorly Lab integration API client (kiorex-contracts openapi/kiorly-lab.v1.openapi.json; KX-07 KLORD02, KLCRIT02/03). Same HMAC scheme;
 * connection from the PartnerRegistry, path prefix `/api/v1/integration/v1`. The client key binds the lab tenant (no org header); the lab
 * (branch) is `labId`. Results return only as the LabResultReleased event (signed report version + secure link).
 *
 *   GET  /tests?q&labId                   test catalogue with authoritative prices
 *   POST /tests/quote                     authoritative prices for test codes (+ collection fee)
 *   GET  /labs/{labId}/slots              collection slots: collectionType=HOME|WALK_IN, from, to
 *   POST /orders            sourceRef = Kiorex booking id (idempotent)   create the lab order
 *   POST /orders/{sourceRef}/cancel
 */
@Injectable()
export class LabClient {
  constructor(private readonly registry: PartnerRegistry) {}
  private conn() { return this.registry.conn('LAB'); }
  async tests(q: { q?: string; labId?: string }) { return partnerRequest<{ items: LabTestDto[] }>(await this.conn(), { method: 'GET', path: '/tests', query: q }); }
  async quote(body: { labId: string; testCodes: string[]; collectionType: string }) { return partnerRequest<{ tests: { code: string; name: string; nameAr?: string; priceMinor: number }[]; collectionFeeMinor: number }>(await this.conn(), { method: 'POST', path: '/tests/quote', body }); }
  async slots(labId: string, q: { collectionType: string; from: string; to: string; tests?: string }) { return partnerRequest<{ slots: { startsAt: string; endsAt: string }[] }>(await this.conn(), { method: 'GET', path: `/labs/${encodeURIComponent(labId)}/slots`, query: q }); }
  /** Idempotent on `sourceRef` (= Kiorex booking id); the lab answers its internal order id and status (never REJECTED: refusals are 4xx). */
  async createOrder(key: string, body: LabOrderIntent) { return partnerRequest<{ orderId: string; orderNumber?: string; status: string; created?: boolean }>(await this.conn(), { method: 'POST', path: '/orders', body, idempotencyKey: key }); }
  /** `sourceRef` = Kiorex booking id. 409/422 when the specimen was already collected. */
  async cancelOrder(sourceRef: string, _reason: string) { return partnerRequest<{ orderId: string; status: string }>(await this.conn(), { method: 'POST', path: `/orders/${encodeURIComponent(sourceRef)}/cancel`, body: {} }); }
}

/** Kiorex booking -> Lab inbound order (strict contract shape; no clinical data, identity checked again at collection). */
export interface LabOrderIntent {
  sourceRef: string; labId: string;
  patient: { fullName: string; phone?: string; externalId: string; dateOfBirth?: string; sex?: 'M' | 'F' | 'OTHER' | 'UNKNOWN'; preferredLocale?: 'ar' | 'en' };
  testCodes: string[];
  collection: { type: 'IN_LAB' | 'HOME'; address?: string; windowStart: string; windowEnd: string; contactPhone?: string };
  consentChannels: ('KIOREX_VAULT')[];
}
/** Arabic fields are optional (contracts 1.8.0): when the lab holds none the patient apps show the English `name` / `preparation` / `sampleType`. */
export interface LabTestDto { labId: string; labName: string; code: string; name: string; nameAr?: string; priceMinor: number; sampleType?: string; sampleTypeAr?: string; homeCollection: boolean; preparation?: string; preparationAr?: string }
