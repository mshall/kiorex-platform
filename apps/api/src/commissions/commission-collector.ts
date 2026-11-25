import { Injectable } from '@nestjs/common';
import { cfg } from '../common/config';
import { assertRealModeApproved } from '../common/providers/mode-guard';
import { PSP_INTEGRATION_KEY } from '../pay/pay-public';

export const COMMISSION_COLLECTOR = 'COMMISSION_COLLECTOR';
export type ChargeResult = { ok: true; providerRef: string } | { ok: false; code: string; retryable: boolean };
export interface ChargeInput { orgRef: string; provider: string; tokenRef: string; amountMinor: number; currency: string; idempotencyKey: string; attemptNo: number }
/**
 * Port to the provider rail that charges an organisation's SAVED method (token / mandate) for commission. The provider holds the card data; Kiorex stores only the opaque token reference.
 * Idempotent on `idempotencyKey`: the same key never charges twice (the provider is asked to dedupe on it as well).
 */
export interface CommissionCollectorPort { chargeSaved(i: ChargeInput): Promise<ChargeResult> }

/**
 * MOCK collector (default, MODE=mock like every integration): deterministic, exercises the same code path as a real rail. The token reference decides the outcome:
 *   fail_retry*  -> retryable decline every time (INSUFFICIENT_FUNDS); fail_once* -> declines on attempt 1 only; fail_hard* -> non-retryable (CARD_EXPIRED); anything else succeeds.
 * Replays of one idempotency key return the first answer.
 */
@Injectable()
export class MockCommissionCollector implements CommissionCollectorPort {
  private readonly seen = new Map<string, ChargeResult>();
  async chargeSaved(i: ChargeInput): Promise<ChargeResult> {
    const prior = this.seen.get(i.idempotencyKey);
    if (prior) return prior;
    const t = i.tokenRef;
    const r: ChargeResult = t.startsWith('fail_hard') ? { ok: false, code: 'CARD_EXPIRED', retryable: false }
      : t.startsWith('fail_retry') || (t.startsWith('fail_once') && i.attemptNo === 1) ? { ok: false, code: 'INSUFFICIENT_FUNDS', retryable: true }
      : { ok: true, providerRef: `mockchg_${i.idempotencyKey.replace(/[^A-Za-z0-9]/g, '').slice(-24)}` };
    this.seen.set(i.idempotencyKey, r);
    return r;
  }
}

/**
 * REAL collector: fails CLOSED. Real mode needs the approved INTEGRATION_MODES record of the chosen provider (second super admin, maker-checker) AND the provider's tokenised-charge API,
 * which is not wired (vendor spec, merchant agreement and counsel's funds-flow decision are NEEDS_HUMAN, LG-COM-3 / LG-COM-4). Until then a real-mode run falls back to an invoice (safe, visible).
 */
@Injectable()
export class RealCommissionCollector implements CommissionCollectorPort {
  async chargeSaved(i: ChargeInput): Promise<ChargeResult> {
    const key = (PSP_INTEGRATION_KEY as Record<string, string>)[i.provider] ?? i.provider.toUpperCase();
    assertRealModeApproved(key);
    throw new Error(`NEEDS_HUMAN: saved-method charging through ${i.provider} is not wired (provider tokenised-charge API, merchant agreement and counsel's funds-flow decision, LG-COM-3)`);
  }
}

export const collectorForMode = (mock: MockCommissionCollector, real: RealCommissionCollector): CommissionCollectorPort => (cfg().pspMode === 'sandbox-fake' ? mock : real);
