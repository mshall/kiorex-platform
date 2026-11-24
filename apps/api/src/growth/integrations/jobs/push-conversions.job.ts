import { Injectable } from '@nestjs/common';
import { assertAdSafe, AdUnsafeError } from '../assert-ad-safe';
import { IntegrationService } from '../integration.service';
import type { AnonymizedConversion, GrowthIntegrationKind } from '../port';

/**
 * Anonymised conversion upload (Google Ads, Meta, TikTok): DEFAULT DISABLED and not implemented against any vendor in this phase. What exists is the gate: every candidate is passed through
 * `assertAdSafe`, a mock integration counts what it would have sent and sends nothing, and a `real` integration refuses (NEEDS_HUMAN) until the DPO record, the consent copy and the
 * conversion-upload adapter exist (H-9). Aggregates only: the caller supplies hourly counts per campaign, never a booking or a person.
 */
@Injectable()
export class PushConversionsJob {
  constructor(private readonly svc: IntegrationService) {}
  async prepare(batch: unknown[], opts: { consentAnalytics: boolean; valueBucketMinor?: number }): Promise<{ safe: AnonymizedConversion[]; rejected: number }> {
    const safe: AnonymizedConversion[] = []; let rejected = 0;
    for (const c of batch) { try { safe.push(assertAdSafe(c, opts)); } catch (e) { if (e instanceof AdUnsafeError) rejected++; else throw e; } }
    return { safe, rejected };
  }
  async runOnce(kind: GrowthIntegrationKind, market: string, batch: unknown[], opts: { consentAnalytics: boolean }) {
    const s = await this.svc.setting(kind, market);
    const enabled = (s as unknown as { pushConversions?: boolean }).pushConversions === true;
    if (!enabled) return { sent: 0, reason: 'DISABLED' as const };
    const { safe, rejected } = await this.prepare(batch, opts);
    if (s.mode === 'mock') return { sent: 0, wouldSend: safe.length, rejected, reason: 'MOCK_SENDS_NOTHING' as const };
    return { sent: 0, rejected, reason: 'NEEDS_HUMAN' as const };
  }
}
