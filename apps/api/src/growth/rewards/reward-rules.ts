import { GROWTH_DEFAULT_PAYLOADS } from '../config/growth-defaults';

/** Typed view of the REWARD_RULES payload (contracts 1.12.0 schema, validated on every write). Missing keys fall back to the PROPOSED_DEFAULT payload, never to "more permissive". */
export interface RewardRules {
  mode: 'COUPON' | 'CREDIT';
  currency: string;
  amounts: { referrerMinor: number; refereeMinor: number; repeatMinor: number; promoMinor: number };
  expiryMonths: number;
  perUserAnnualCapMinor: number;
  perCampaignCapMinor: number;
  ruleBudgetCeilingMinor: number;
  redemptionMaxBp: number;
  minPayableMinor: number;
  postToPayLedger: boolean;
  reversalWindowDays: number;
  holdMaxDays: number;
  manualApprovalAboveMinor: number;
  manualDailyCapPerActorMinor: number;
  issueOn: string[];
  credit: {
    maxOpenBalanceMinor: number;
    refundAsCredit: { enabled: boolean; refundCreditExpiryMonths: number; refundCreditOnExpiry: 'REFUND_TO_ORIGINAL' | 'FORFEIT'; restoredLotMinDays: number };
    family: { enabled: boolean };
    goodwill: { reasons: string[]; perAgentDailyCapMinor: number; perPatient90dCapMinor: number; perReasonMaxMinor: number; approvalAboveMinor: number };
    campaignScope: { serviceKinds: string[]; specialtyAllowlist?: string[] };
  };
}

/** Days a subject is blocked from new issuance after a recoverable loss (REWARD_RULES has no key for it in contracts 1.12.0; code constant, a 1.12.1 request would make it config). */
export const RECOVERABLE_LOSS_BLOCK_DAYS = 90;
/** Largest number of active (unexpired, unspent) lots one patient may hold: keeps the wallet readable and the ledger scans bounded. */
export const MAX_ACTIVE_LOTS = 50;

export function toRewardRules(payload: Record<string, unknown> | undefined): RewardRules {
  const d = GROWTH_DEFAULT_PAYLOADS.REWARD_RULES as unknown as RewardRules;
  const p = (payload ?? {}) as Partial<RewardRules>;
  return {
    ...d, ...p,
    amounts: { ...d.amounts, ...(p.amounts ?? {}) },
    credit: {
      ...d.credit, ...(p.credit ?? {}),
      refundAsCredit: { ...d.credit.refundAsCredit, ...(p.credit?.refundAsCredit ?? {}) },
      family: { ...d.credit.family, ...(p.credit?.family ?? {}) },
      goodwill: { ...d.credit.goodwill, ...(p.credit?.goodwill ?? {}) },
      campaignScope: { ...d.credit.campaignScope, ...(p.credit?.campaignScope ?? {}) },
    },
  };
}
