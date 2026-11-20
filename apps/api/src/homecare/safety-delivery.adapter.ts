import { cfg } from '../common/config';

/**
 * Safety-alert delivery to Kiorex ops on-call (KX-09 §08: <= 60 s). MODE=mock|real (SAFETY_DELIVERY_MODE, default mock): the mock
 * records a deterministic delivery (the console shows it as the on-call page); real paging (on-call tool / SMS / voice) is a pre-launch
 * go-live task (Docs/NEEDS_HUMAN.md "Provider go-live"). Payload carries ids + district only, never an address or phone.
 */
export interface SafetyDeliveryPayload { alertId: string; kind: string; district: string | null; bookingId: string | null; level: number }
export interface SafetyDeliveryResult { ok: boolean; ref: string; error?: string }
export interface SafetyDeliveryAdapter { readonly mode: 'mock' | 'real'; deliver(p: SafetyDeliveryPayload): Promise<SafetyDeliveryResult> }

export class MockSafetyDelivery implements SafetyDeliveryAdapter {
  readonly mode = 'mock' as const;
  /** Tests can force failures: `MockSafetyDelivery.failNext = n`. */
  static failNext = 0;
  async deliver(p: SafetyDeliveryPayload): Promise<SafetyDeliveryResult> {
    if (MockSafetyDelivery.failNext > 0) { MockSafetyDelivery.failNext--; return { ok: false, ref: '', error: 'MOCK_PAGER_DOWN' }; }
    return { ok: true, ref: `mock_oncall_${p.alertId}_L${p.level}` };
  }
}
export class UnconfiguredSafetyDelivery implements SafetyDeliveryAdapter {
  readonly mode = 'real' as const;
  async deliver(): Promise<SafetyDeliveryResult> { return { ok: false, ref: '', error: 'NEEDS_HUMAN: on-call paging provider not configured (Docs/NEEDS_HUMAN.md, Provider go-live)' }; }
}
export const safetyDelivery = (): SafetyDeliveryAdapter => (cfg().safetyDeliveryMode === 'mock' ? new MockSafetyDelivery() : new UnconfiguredSafetyDelivery());
