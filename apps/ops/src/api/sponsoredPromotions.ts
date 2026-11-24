// GRW-P2-S ops hooks over /api/v1/admin/growth/sponsored-promotions. Public advertising text, rules and opaque references only: no patient field exists in any response.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/sponsored-promotions";
export type ReviewKind = "CONTENT" | "SCOPE" | "HIGH_VALUE";
export type ReviewDecisionKey = "APPROVED" | "REJECTED" | "NEEDS_CHANGES";
export interface QueueRow { promotionId: string; version: number; orgRef: string; status: string; nameAr: string; nameEn: string; budgetCapMinor: number; updatedAt: string; reviews: Array<{ kind: ReviewKind; decision: ReviewDecisionKey | null; decidedAt: string | null }> }
export interface GuardHit { rule: string; term: string; severity: "BLOCK" | "WARN"; lang: "en" | "ar" }
export interface PromotionDetail {
  promotionId: string; version: number; orgRef: string; status: string; nameAr: string; nameEn: string; patientCopyAr: string; patientCopyEn: string;
  scope: { doctorIds?: string[]; appointmentTypeIds?: string[]; careTypes?: string[] }; discount: { kind?: string; value?: number; maxPerBookingMinor?: number }; eligibility: Record<string, unknown>;
  budgetCapMinor: number; fundingMode: string; startsAt: string | null; endsAt: string | null; contentHash: string; highValue: string[];
  guard: { ok: boolean; hits: GuardHit[]; signal: string | null; listVersion: string };
  reviews: Array<{ id: string; kind: ReviewKind; decision: ReviewDecisionKey | null; reason: string | null; decidedAt: string | null }>;
}
export interface LedgerView { promotionId: string; total: number; page: number; pageSize: number; lines: Array<{ id: string; bookingIntentId: string; promotionVersion: number; amountMinor: number; signedAmountMinor: number; currency: string; state: string; ledgerLine: string; createdAt: string; updatedAt: string }>; byState: Array<{ state: string; count: number; amountMinor: number }> }

export const useSponsoredQueue = (status: "IN_REVIEW" | "ACTIVE" | "ALL") => useQuery({ queryKey: ["growth", "sponsored", "queue", status], queryFn: () => rawApi<QueueRow[]>("GET", `${B}?status=${status}`) });
export const useSponsoredDetail = (id: string) => useQuery({ queryKey: ["growth", "sponsored", "detail", id], enabled: !!id, queryFn: () => rawApi<PromotionDetail>("GET", `${B}/${encodeURIComponent(id)}`) });
export const useSponsoredLedger = (id: string) => useQuery({ queryKey: ["growth", "sponsored", "ledger", id], enabled: !!id, queryFn: () => rawApi<LedgerView>("GET", `${B}/${encodeURIComponent(id)}/ledger`) });
export function useSponsoredDecision() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; version: number; kind: ReviewKind; decision: ReviewDecisionKey; note?: string }) => rawApi<PromotionDetail>("POST", `${B}/${encodeURIComponent(v.id)}/decisions`, { version: v.version, kind: v.kind, decision: v.decision, note: v.note }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["growth", "sponsored"] }) });
}
