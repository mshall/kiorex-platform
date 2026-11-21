import { cfg } from '../common/config';
import { providerProblems } from '../common/providers/env';
import { createMessagingAdapter } from '../messaging/messaging-public';

/**
 * Safety-alert delivery to Kiorex ops on-call (KX-09 §08: <= 60 s). MODE=mock|real (SAFETY_DELIVERY_MODE, default mock): the mock
 * records a deterministic delivery (the console shows it as the on-call page); real paging goes out as SMS to SAFETY_ONCALL_PHONES through the real SMS provider
 * (Docs/PROVIDERS.md); a dedicated paging tool (PagerDuty/voice) would be another adapter here. Payload carries ids + district only, never an address or phone.
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
/** SAFETY_DELIVERY_MODE=real: pages SAFETY_ONCALL_PHONES through the real SMS provider (SMS_MODE=real). Text carries ids + district only. */
export class SmsSafetyDelivery implements SafetyDeliveryAdapter {
  readonly mode = 'real' as const;
  async deliver(p: SafetyDeliveryPayload): Promise<SafetyDeliveryResult> {
    const phones = cfg().safetyOncallPhones;
    const sms = createMessagingAdapter('SMS');
    if (!phones.length || sms.mode !== 'real') return { ok: false, ref: '', error: 'ONCALL_NOT_CONFIGURED' };
    const body = `Kiorex SAFETY L${p.level} ${p.kind}${p.district ? ` ${p.district}` : ''} alert ${p.alertId}${p.bookingId ? ` booking ${p.bookingId}` : ''}`;
    const refs: string[] = []; let error: string | undefined;
    for (const to of phones) {
      try { const r = await sms.send({ channel: 'SMS', to, templateId: 'safety_oncall', locale: 'en', body, messageId: `safety:${p.alertId}:L${p.level}:${to}` }); if (r.ok) refs.push(r.providerRef); else error = r.error; }
      catch (e) { error = String((e as Error)?.message ?? e).slice(0, 120); }
    }
    return refs.length ? { ok: true, ref: refs.join(',') } : { ok: false, ref: '', error: error ?? 'SEND_FAILED' };
  }
}
export const safetyDelivery = (): SafetyDeliveryAdapter => {
  if (cfg().safetyDeliveryMode === 'mock') return new MockSafetyDelivery();
  return providerProblems('SMS').length || !cfg().safetyOncallPhones.length ? new UnconfiguredSafetyDelivery() : new SmsSafetyDelivery();
};
