import { Injectable } from '@nestjs/common';
import { partnerRequest } from '../common/partner-http';
import { PartnerRegistry } from '../partners/partners-public';

/**
 * Kiorly Pharmacy machine API client (kiorex-contracts openapi/kiorly-pharmacy.v1.openapi.json; KX-06 KPMKT01-05, KPINV07).
 * Auth = the Kiorly HMAC request scheme; connection (host + client key/secret) comes from the PartnerRegistry, path prefix `/marketplace/v1`.
 * The client key addresses the pharmacy tenant (NH-PH-024 resolved: no org header); the branch is `pharmacyId`/`branchId` in the body.
 *
 *   GET  /pharmacies                          opted-in branches: delivery options (KPMKT01)
 *   GET  /catalogue?q&pharmacyId              OTC + Rx-only items with availability-to-promise (KPINV07); controlled items NEVER listed (KPRX05)
 *   POST /catalogue/quote                     authoritative price/availability for a cart (minor units)
 *   POST /orders            orderId = Kiorex order id (idempotent)   create order intent AFTER payment capture (KPMKT02)
 *   POST /prescriptions/validate              Rx validation request (KPMKT04): pharmacist-gated, answer may be PENDING
 *   POST /orders/{orderId}/cancel
 */
@Injectable()
export class PharmacyClient {
  constructor(private readonly registry: PartnerRegistry) {}
  /** `registrationId` = the registration that owns the pharmacy (per-registration routing); omitted/null = legacy first-active / env default. */
  private conn(registrationId?: string | null) { return this.registry.conn('PHARMACY', registrationId); }
  async pharmacies(registrationId?: string | null) { return partnerRequest<{ items: PharmacyDto[] }>(await this.conn(registrationId), { method: 'GET', path: '/pharmacies' }); }
  async catalogue(q: { q?: string; pharmacyId?: string }, registrationId?: string | null) { return partnerRequest<{ items: CatalogueItemDto[] }>(await this.conn(registrationId), { method: 'GET', path: '/catalogue', query: q }); }
  async quote(body: { pharmacyId: string; items: { sku: string; qty: number }[]; delivery?: { method: string } }, registrationId?: string | null) { return partnerRequest<QuoteDto>(await this.conn(registrationId), { method: 'POST', path: '/catalogue/quote', body }); }
  /** `key` = Kiorex order id: the Idempotency-Key header AND the contract's `orderId`, so a retry (timeout, outbox replay) can never double-create. */
  async createOrder(key: string, body: PharmacyOrderIntent, registrationId?: string | null) { return partnerRequest<{ orderId: string; status: PharmacyPartnerStatus; slaDueAt?: string; replayed?: boolean }>(await this.conn(registrationId), { method: 'POST', path: '/orders', body, idempotencyKey: key }); }
  async validatePrescription(body: { orderId: string; prescriptionRef: string; verificationToken: string; patientRef: string }, registrationId?: string | null) { return partnerRequest<{ status: 'VALID' | 'INVALID' | 'PENDING'; reason?: string }>(await this.conn(registrationId), { method: 'POST', path: '/prescriptions/validate', body }); }
  async cancelOrder(orderId: string, reason: string, registrationId?: string | null) { return partnerRequest<{ status: string }>(await this.conn(registrationId), { method: 'POST', path: `/orders/${encodeURIComponent(orderId)}/cancel`, body: { reason } }); }
}

export type PharmacyPartnerStatus = 'RECEIVED' | 'ACCEPTED' | 'PARTIALLY_ACCEPTED' | 'READY' | 'OUT_FOR_DELIVERY' | 'DISPENSED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
/** Kiorex -> Pharmacy order intent. Unit prices are decimal MAJOR units (the pharmacy ledger unit); the pharmacy refuses a stale price. */
export interface PharmacyOrderIntent {
  orderId: string; branchId: string; patientRef: string; customer?: { name?: string; phone?: string; address?: string }; prepaid: true;
  lines: { sku: string; quantity: number; unitPrice: string }[];
  delivery: { method: string; address?: unknown };
  payment: { reference: string | null; totalMinor: number; currency: string };
  prescription?: { recordRef: string; verificationToken: string };
}

export interface PharmacyDto { id: string; name: string; delivery: { enabled: boolean; feeMinor: number; radiusKm?: number }; pickup: boolean; prepMinutes?: number }
/** `nameAr` / `formAr` / `activeIngredient` are optional (contracts 1.8.0): the patient apps fall back to `name` / `form` when absent. */
export interface CatalogueItemDto { pharmacyId: string; sku: string; name: string; nameAr?: string; activeIngredient?: string; strength?: string; form?: string; formAr?: string; priceMinor: number; rxRequired: boolean; controlled: boolean; available: boolean }
export interface QuoteDto { items: { sku: string; name: string; nameAr?: string; strength?: string; form?: string; formAr?: string; qty: number; unitPriceMinor: number; rxRequired: boolean; controlled: boolean; available: boolean }[]; delivery?: { feeMinor: number } }
