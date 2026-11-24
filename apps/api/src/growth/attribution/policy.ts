import { Injectable } from '@nestjs/common';
import { GrowthConfigService } from '../config/growth-config.service';
import { GROWTH_DEFAULT_PAYLOADS } from '../config/growth-defaults';
import type { DecisionPolicy } from './decide';

export interface AttributionPolicyPayload {
  providerTouchWindowDays: number; patientReferralWindowDays: number; campaignClickWindowDays: number; campaignViewWindowHours: number; visitorKeyMaxDays: number;
  newPatientLookbackMonths: number; touchEvidenceRetentionMonths: number; unlinkedTouchRetentionMonths: number; minDwellMsForProviderTouch: number; ltTokenTtlMinutes: number;
  precedence: 'PROVIDER_FIRST' | 'LAST_NON_DIRECT' | 'FIRST_TOUCH'; allowOfflineEvidence: boolean;
}

/** Turns the resolved ATTRIBUTION_POLICY (ACTIVE version, else PROPOSED_DEFAULT) into the input of the pure decision function. */
export function toDecisionPolicy(versionId: string, p: AttributionPolicyPayload): DecisionPolicy {
  // FIRST_TOUCH is reporting only (ARCH 6.3): a commission decision under it falls back to the default PROVIDER_FIRST rather than failing a booking
  const precedence = p.precedence === 'FIRST_TOUCH' ? 'PROVIDER_FIRST' : p.precedence;
  return { versionId, providerTouchWindowDays: p.providerTouchWindowDays, patientReferralWindowDays: p.patientReferralWindowDays, campaignClickWindowDays: p.campaignClickWindowDays, minDwellMsForProviderTouch: p.minDwellMsForProviderTouch, precedence, allowOfflineEvidence: p.allowOfflineEvidence };
}

/** Resolves the policy through GrowthConfigService (ARCH 16). `get` returns the payload only; `decisionPolicy` also names the version the decision will cite. */
@Injectable()
export class AttributionPolicyResolver {
  constructor(private readonly config: GrowthConfigService) {}
  async get(market: string, at: Date): Promise<AttributionPolicyPayload> {
    return (await this.config.resolve<AttributionPolicyPayload>('ATTRIBUTION_POLICY', { market, at })).payload ?? (GROWTH_DEFAULT_PAYLOADS.ATTRIBUTION_POLICY as unknown as AttributionPolicyPayload);
  }
  async decisionPolicy(market: string, at: Date): Promise<{ policy: DecisionPolicy; versionId: string; version: number; source: string; payload: AttributionPolicyPayload }> {
    const r = await this.config.resolve<AttributionPolicyPayload>('ATTRIBUTION_POLICY', { market, at });
    return { policy: toDecisionPolicy(r.versionId, r.payload), versionId: r.versionId, version: r.version, source: r.source, payload: r.payload };
  }
}
