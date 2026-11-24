import type { FraudAction, FraudBand, FraudFeatures, FraudSurface } from './signals';

/** Façade of the fraud package for the rest of the API: the scorer port and its types. Callers inject the token (optional), never import services. */
export const FRAUD_SCORER = Symbol('FRAUD_SCORER');

export interface AssessContext {
  market?: string;
  /** an opaque subject (a sub, `ip:<hash>`, `widget:<ref>`); it is hashed with the keyed hash before it is stored */
  subject: string;
  /** `rel:<relationshipId>` ties the case to a referral relationship; `claim:`, `touch:`, `widget:` for the others */
  evidenceRef: string;
  relationshipIds?: string[];
  touchRef?: string;
  originRef?: string;
}
export interface Assessment { action: FraudAction; shadowAction: FraudAction; band: FraudBand; score: number; caseId: string | null }

export interface FraudScorer {
  assess(surface: FraudSurface, features: FraudFeatures, ctx: AssessContext): Promise<Assessment>;
  onTouch(t: { ipHash: string; burst: boolean; burstLimit: number; clickWithoutRender: boolean; day?: string }): Promise<Assessment | null>;
  onLinkToken(t: { ipHash: string; ok: boolean; tokenId?: string; expired?: boolean }): Promise<Assessment | null>;
  onWidgetDenied(t: { org: string | null; origin: string | null | undefined; reason: string }): Promise<void>;
  originThrottled(origin: string | null | undefined): Promise<boolean>;
}
export { FRAUD_RULE_IDS, FRAUD_ACTIONS, FRAUD_SURFACES } from './signals';
export type { FraudAction, FraudBand, FraudFeatures, FraudSurface } from './signals';
