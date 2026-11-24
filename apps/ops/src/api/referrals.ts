// GRW-P2-B3: ops hooks over /api/v1/admin/growth/{referrals,rewards,credit}/* (built by GRW-P2-B1 and B2). Shapes follow the controllers of those packages; a field the server leaves out is rendered as "—".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi, rawText } from "./client";

const B = "/admin/growth";
const qs = (o: Record<string, string | number | undefined | null>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ""; };
export type Masked = number | "<10";

export interface ReferralOverview { funnel: { relationships: Masked; signedUp: Masked; booked: Masked; qualified: Masked; rejected: Masked; expired: Masked; onHold: Masked }; queue: Array<{ id: string; status: string; createdAt: string; holdUntil: string | null }>; note?: string }
export interface ReferralCheck { key: string; passed: boolean; detail?: Record<string, unknown> | null; at: string }
export interface ReferralSignal { id: string; ruleId: string; score: number; reviewStatus: string; createdAt?: string }
export interface ReferralDetail { id: string; status: string; reviewState: string | null; rejectReason: string | null; createdAt: string; completedAt: string | null; holdUntil: string | null; qualifiedAt: string | null; ruleVersionId: string; referrerRef: string; refereeRef: string; checks: ReferralCheck[]; signals: ReferralSignal[]; error?: string }
export type ReferralDecision = "QUALIFY_OVERRIDE" | "REJECT" | "RELEASE_HOLD";

export const useReferralOverview = () => useQuery({ queryKey: ["growth", "referrals"], queryFn: () => rawApi<ReferralOverview>("GET", `${B}/referrals`) });
export const useReferral = (id: string) => useQuery({ queryKey: ["growth", "referral", id], enabled: !!id, queryFn: () => rawApi<ReferralDetail>("GET", `${B}/referrals/${encodeURIComponent(id)}`) });
export function useReferralDecision() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; decision: ReferralDecision; note?: string }) => rawApi<Record<string, unknown>>("POST", `${B}/referrals/${encodeURIComponent(v.id)}/decision`, { decision: v.decision, note: v.note }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["growth"] }) });
}

export interface RewardsOverview { mode: string; effectiveMode: string; ruleVersionId: string; source: string; flags: Record<string, boolean>; amounts?: Record<string, unknown>; postToPayLedger?: boolean; banner: "NO_DEPOSIT_CONFIGURED" | null; openApprovals: number }
export interface RewardLotRow { id: string; patientRef: string; kind: string; mode: string; funding: string; status: string; amountMinor: number; currency: string; availableMinor: number; heldMinor: number; reservedMinor: number; expiresAt: string; createdAt: string; campaignId: string | null; ruleVersionId: string }
export interface LedgerEntry { id: string; type: string; amountMinor: number; reasonCode: string; bookingId: string | null; refundId: string | null; actor: string; idempotencyKey: string; createdAt: string }
export interface RewardApproval { id: string; kind: string; amountMinor: number; reason: string; bookingId: string | null; ticketRef: string | null; requestedBy: string; createdAt: string }
export interface FinanceRow { market: string; currency: string; kind: string; funding: string; ruleVersionId: string; campaignId: string | null; issuedMinor: number; redeemedMinor: number; reversedMinor: number; expiredMinor: number }
export interface FinanceReport { month: string; rows: FinanceRow[]; totals: { issuedMinor: number; redeemedMinor: number; reversedMinor: number; expiredMinor: number }; outstanding: Array<{ currency: string; market: string; platformFundedMinor: number; serviceRecoveryMinor: number; refundCreditLiabilityMinor: number; totalMinor: number }>; recoverableLossMinor: number; kiorexRevenueEffectMinor: 0; note: string }

export const useRewardsOverview = () => useQuery({ queryKey: ["growth", "rewards"], queryFn: () => rawApi<RewardsOverview>("GET", `${B}/rewards`) });
export const useRewardLots = (f: { status?: string; kind?: string; funding?: string }) => useQuery({ queryKey: ["growth", "reward-lots", f], queryFn: () => rawApi<RewardLotRow[]>("GET", `${B}/rewards/lots${qs({ ...f, take: 100 })}`) });
export const useLotLedger = (id: string) => useQuery({ queryKey: ["growth", "reward-ledger", id], enabled: !!id, queryFn: () => rawApi<LedgerEntry[]>("GET", `${B}/rewards/lots/${encodeURIComponent(id)}/ledger`) });
export const useRewardApprovals = () => useQuery({ queryKey: ["growth", "reward-approvals"], queryFn: () => rawApi<RewardApproval[]>("GET", `${B}/rewards/approvals`) });
export const useRewardFinance = (month: string) => useQuery({ queryKey: ["growth", "reward-finance", month], queryFn: () => rawApi<FinanceReport>("GET", `${B}/rewards/finance${qs({ month })}`), retry: false });
export function useRewardActions() {
  const qc = useQueryClient(); const done = () => void qc.invalidateQueries({ queryKey: ["growth"] });
  return {
    manualIssue: useMutation({ mutationFn: (b: { sub: string; amountMinor: number; reason: string; bookingId?: string; ticketRef?: string }) => rawApi<Record<string, unknown>>("POST", `${B}/rewards/manual-issue`, b), onSuccess: done }),
    hold: useMutation({ mutationFn: (v: { id: string; reasonCode?: string }) => rawApi<Record<string, unknown>>("POST", `${B}/rewards/lots/${encodeURIComponent(v.id)}/hold`, { reasonCode: v.reasonCode }), onSuccess: done }),
    release: useMutation({ mutationFn: (id: string) => rawApi<Record<string, unknown>>("POST", `${B}/rewards/lots/${encodeURIComponent(id)}/release`, {}), onSuccess: done }),
    decide: useMutation({ mutationFn: (v: { id: string; decision: "APPROVED" | "REJECTED"; note?: string }) => rawApi<Record<string, unknown>>("POST", `${B}/rewards/approvals/${encodeURIComponent(v.id)}/decide`, { decision: v.decision, note: v.note }), onSuccess: done }),
  };
}
/** CSV of the month through the authenticated client (a plain link cannot send the bearer token). */
export const downloadFinanceCsv = (month: string) => rawText(`${B}/rewards/finance.csv${qs({ month })}`);
