import { Injectable } from '@nestjs/common';
import { cfg } from '../common/config';
import { partnerRequest } from '../common/partner-http';

/**
 * Kiorly Pharmacy operational API client — DRAFT CONTRACT (Kiorly Pharmacy is not built in this wave; KX-06 KPMKT01-05, KPINV07).
 * Same HMAC scheme as the marketplace API; base `${KIORLY_PHARMACY_BASE_URL}` (default http://localhost:3020/pharmacy/v1).
 * Documented in Docs/VERTICALS.md; events come back as OrderReady / DispenseCompleted / OrderRejected (kiorex-contracts, v2-draft).
 *
 *   GET  /pharmacies                          opted-in branches: delivery options (KPMKT01)
 *   GET  /catalogue?q&pharmacyId              OTC + Rx-only items with availability-to-promise (KPINV07); controlled items NEVER listed (KPRX05)
 *   POST /catalogue/quote                     authoritative price/availability for a cart
 *   POST /orders            Idempotency-Key = Kiorex order id   create order intent after payment (KPMKT02)
 *   POST /prescriptions/validate              Rx validation request (KPMKT04): pharmacist-gated, answer may be PENDING
 *   POST /orders/{orderId}/cancel
 */
@Injectable()
export class PharmacyClient {
  private conn() { const c = cfg(); return { baseUrl: c.pharmacyBaseUrl, clientKey: c.pharmacyClientKey, clientSecret: c.pharmacyClientSecret, timeoutMs: c.partnerTimeoutMs }; }
  pharmacies() { return partnerRequest<{ items: PharmacyDto[] }>(this.conn(), { method: 'GET', path: '/pharmacies' }); }
  catalogue(q: { q?: string; pharmacyId?: string }) { return partnerRequest<{ items: CatalogueItemDto[] }>(this.conn(), { method: 'GET', path: '/catalogue', query: q }); }
  quote(body: { pharmacyId: string; items: { sku: string; qty: number }[]; delivery?: { method: string } }) { return partnerRequest<QuoteDto>(this.conn(), { method: 'POST', path: '/catalogue/quote', body }); }
  createOrder(key: string, body: Record<string, unknown>) { return partnerRequest<{ orderId: string; status: 'PENDING_VALIDATION' | 'ACCEPTED' | 'REJECTED'; reason?: string }>(this.conn(), { method: 'POST', path: '/orders', body, idempotencyKey: key }); }
  validatePrescription(body: { orderId: string; prescriptionRef: string; verificationToken: string; patientRef: string }) { return partnerRequest<{ status: 'VALID' | 'INVALID' | 'PENDING'; reason?: string }>(this.conn(), { method: 'POST', path: '/prescriptions/validate', body }); }
  cancelOrder(orderId: string, reason: string) { return partnerRequest<{ status: string }>(this.conn(), { method: 'POST', path: `/orders/${encodeURIComponent(orderId)}/cancel`, body: { reason } }); }
}

export interface PharmacyDto { id: string; name: string; delivery: { enabled: boolean; feeMinor: number; radiusKm?: number }; pickup: boolean; prepMinutes?: number }
export interface CatalogueItemDto { pharmacyId: string; sku: string; name: string; strength?: string; form?: string; priceMinor: number; rxRequired: boolean; controlled: boolean; available: boolean }
export interface QuoteDto { items: { sku: string; name: string; qty: number; unitPriceMinor: number; rxRequired: boolean; controlled: boolean; available: boolean }[]; delivery?: { feeMinor: number } }
