import { Injectable } from '@nestjs/common';
import { partnerRequest } from '../common/partner-http';
import { PartnerRegistry } from '../partners/partners-public';

/**
 * Kiorly Lab inbound API with the KIORLY_NURSE client source (KNLAB01 / KLORD05, kiorex-contracts 1.6.0 openapi/kiorly-lab.v1.openapi.json).
 * Kiorex holds this second registration (PartnerRegistry kind LAB_NURSE) and relays on behalf of Kiorly Nurse (an edition of Kiorly Clinic).
 *   POST /orders                         nurse-collected order (idempotent on sourceRef = the Kiorly ClinicalOrder id)
 *   GET  /orders/{sourceRef}/custody     chain of custody for an order this client placed (no names, no PHI)
 */
@Injectable()
export class NurseLabClient {
  constructor(private readonly registry: PartnerRegistry) {}
  private conn() { return this.registry.conn('LAB_NURSE'); }
  async createOrder(key: string, body: NurseLabOrderIntent) { return partnerRequest<{ orderId: string; orderNumber?: string; status: string; created?: boolean }>(await this.conn(), { method: 'POST', path: '/orders', body, idempotencyKey: key }); }
  async custody(sourceRef: string) { return partnerRequest<LabCustodyDto>(await this.conn(), { method: 'GET', path: `/orders/${encodeURIComponent(sourceRef)}/custody` }); }
}

export interface NurseLabOrderIntent {
  sourceRef: string;
  labId?: string;
  patient: { fullName: string; dateOfBirth?: string; sex?: 'M' | 'F' | 'OTHER' | 'UNKNOWN'; phone?: string; externalId: string; preferredLocale?: 'ar' | 'en' };
  testCodes: string[];
  priority: 'ROUTINE';
  referringDoctor?: { name?: string; ref?: string };
  consentChannels: ('KIORLY_NURSE_IMPORT' | 'KIOREX_VAULT')[];
  identifiersChecked: string[];
  nurseCollection: { visitRef: string; collectorRef: string; collectorName?: string; collectedAt: string; handedOverAt?: string; temperatureC?: number; consentToken: string; samples: { label: string; specimenType: string; container?: string }[] };
}

export interface LabCustodyDto {
  sourceRef: string; orderNumber: string; status: string; collectedAt: string | null; receivedAt: string | null;
  specimens: { label: string; accessionNumber?: string; status: string; custody: { type: string; occurredAt: string; by: 'NURSE' | 'LAB'; temperatureC?: number | null; location?: string | null }[] }[];
}
