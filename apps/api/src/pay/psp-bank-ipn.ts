import { BankIpnAdapter, type BankIpnConfig, type PayEvent } from '@kiorex/pay-contract';
import { cfg } from '../common/config';
import { PayNotSupportedError } from '@kiorex/pay-contract';
import type { PspAdapter, PspCapabilities, PspCheckoutInput, PspWebhookEvent } from './psp-types';

/**
 * Bank / IPN rail on the shared contract (@kiorex/pay-contract). The layout is the neutral one below until the bank's real IPN spec arrives (LG-INT-PAY-12, NEEDS_HUMAN);
 * `BANK_IPN_CONFIG_JSON` overrides it (column names, amount unit, signature header and mode, reference pattern, beneficiary label, masked account) without a deploy of code.
 * Kiorly never receives or holds the money: the payer transfers to the merchant / licensed partner account; this adapter only reads the bank's notification.
 */
export const DEFAULT_BANK_IPN_CONFIG: BankIpnConfig = {
  name: 'bank_ipn',
  columns: { bankRef: 'bankRef', amount: 'amount', currency: 'currency', reference: 'reference', paidAt: 'paidAt', payer: 'payer', status: 'status', kind: 'type' },
  amountUnit: 'major', defaultCurrency: 'EGP', successStatuses: ['success', 'completed', 'settled', 'ok'], reversalKinds: ['reversal', 'refund', 'return'],
  referencePattern: '^pay_[A-Za-z0-9_-]{6,}$',
  signature: { header: 'x-webhook-signature', algo: 'sha256', mode: 'ts.body', timestampHeader: 'x-webhook-timestamp', toleranceSec: 300, prefix: 'sha256=' },
};
export function bankIpnConfig(env: Record<string, string | undefined> = process.env): BankIpnConfig {
  let over: Partial<BankIpnConfig> = {};
  try { const j = JSON.parse(env.BANK_IPN_CONFIG_JSON ?? '{}'); if (j && typeof j === 'object' && !Array.isArray(j)) over = j; } catch { /* a bad override never half-applies: the neutral layout stays */ }
  const { signature, columns, ...rest } = over;
  return { ...DEFAULT_BANK_IPN_CONFIG, ...rest, columns: { ...DEFAULT_BANK_IPN_CONFIG.columns, ...(columns ?? {}) }, signature: signature ? { ...DEFAULT_BANK_IPN_CONFIG.signature!, ...signature } : DEFAULT_BANK_IPN_CONFIG.signature };
}

export class BankIpnPspAdapter implements PspAdapter {
  readonly name = 'bank_ipn' as const;
  readonly capabilities: PspCapabilities = { capture: false, void: false, status: false, partialRefund: false, hostedCheckout: false, cardFacts: false };
  readonly core: BankIpnAdapter;
  constructor(private readonly env: Record<string, string | undefined> = process.env, private readonly nowFn: () => Date = () => new Date()) {
    this.core = new BankIpnAdapter(bankIpnConfig(env), env.BANK_IPN_WEBHOOK_SECRET ?? '');
  }
  /** No hosted page: the web shows the transfer instructions (reference = payment id) from /pay/intents/:id/instructions. */
  async createCheckout(i: PspCheckoutInput) {
    const co = await this.core.createCheckout({ paymentId: i.paymentId, amountMinor: i.amountMinor, currency: i.currency, decimals: i.decimals });
    return { pspRef: co.pspRef, checkoutUrl: `${cfg().webBaseUrl}/pay/instructions?payment=${encodeURIComponent(i.paymentId)}` };
  }
  instructions(i: { paymentId: string; amountMinor: number; currency: string; decimals?: number }) { return this.core.createCheckout(i).then((c) => c.instructions!); }
  verifyWebhook(raw: string, headers: Record<string, unknown>): PspWebhookEvent | null { return this.core.verifyWebhook(raw, headers, undefined, this.nowFn()) as PspWebhookEvent | null; }
  /** A daily IPN file uploaded by ops / finance (the same rows, no signature: the uploader is authenticated). */
  ingestFile(content: string, format?: 'csv' | 'json') { return this.core.ingestFile(content, { format }); }
  async refund(): Promise<never> { throw new PayNotSupportedError('bank_ipn', 'refund (the bank returns the transfer; the IPN reversal row records it)'); }
}
export type { PayEvent };
