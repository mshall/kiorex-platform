// GRW-P4-D ops hooks over /api/v1/admin/growth/loyalty. Aggregate numbers (masked below 10 people), the active rules and partnership programs. Nothing here returns a person, a booking or a balance of one person.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/loyalty";
export type Tier = "NONE" | "SILVER" | "GOLD" | "PLATINUM";
export const TIERS = ["SILVER", "GOLD", "PLATINUM"] as const;
/** A masked cell is `null` (fewer than k people). */
export type Cell = number | null;
export interface LoyaltySummary {
  k: number; accounts: Cell; tiers: Record<Tier, Cell>; points: { outstanding: Cell; holders: Cell };
  last30Days: Record<"earned" | "expired" | "reversed" | "converted", { people: Cell; points: Cell }>;
  partnerships: Record<string, { programs: number; budgetMinor: number }>; suppressed: string[];
}
export interface TierRule { minCompletedBookings: number; bonusPoints: number }
export interface LoyaltyRules { enabled: boolean; pointsPerCompletedBooking: number; windowMonths: number; expiryMonths: number; annualCapPoints: number; tiers: Record<"SILVER" | "GOLD" | "PLATINUM", TierRule>; conversion: { pointsRequired: number; valueMinor: number; maxBlocksPerYear: number } }
export interface RulesView { rules: LoyaltyRules; versionId: string; source: string; defaultsOnly: boolean; allZero: boolean; flagOn: boolean }
export type ProgramStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";
export type ProgramKind = "CODE_DISCOUNT" | "CO_PROMO" | "CARD_OFFER";
export interface Program {
  id: string; key: string; partnerRef: string; kind: ProgramKind; nameAr: string; nameEn: string; status: ProgramStatus; fundingMode: "PLATFORM_MARKETING" | "PARTNER_FUNDED"; budgetMinor: number; perRedemptionMinor: number; currency: string;
  startsAt: string | null; endsAt: string | null; campaignId: string | null; legalTextRef: string | null; legalTextIsPlaceholder: boolean; createdBy: string; activatedBy: string | null; usedMinor?: number; redemptions?: number;
  campaign?: { id: string; key: string; name: string; status: string; budgetTotalMinor: number } | null;
}
export interface ProgramCode { id: string; label: string; maxRedemptions: number; redeemedCount: number; expiresAt: string | null; status: "ACTIVE" | "REVOKED" | "EXPIRED" | "EXHAUSTED"; createdAt: string }
export interface CreatedCode { id: string; code: string; label: string; maxRedemptions: number; expiresAt: string | null; shownOnce: true }
export interface ProgramBody { key: string; partnerRef: string; kind: ProgramKind; nameAr?: string; nameEn?: string; budgetMinor?: number; perRedemptionMinor?: number; startsAt?: string | null; endsAt?: string | null; legalTextRef?: string | null }

const key = (...k: unknown[]) => ["growth", "loyalty", ...k];
export const useLoyaltySummary = () => useQuery({ queryKey: key("summary"), queryFn: () => rawApi<LoyaltySummary>("GET", `${B}/summary`) });
export const useLoyaltyRules = () => useQuery({ queryKey: key("rules"), queryFn: () => rawApi<RulesView>("GET", `${B}/rules`) });
export const useTierPreview = (completed: number | null) => useQuery({ queryKey: key("preview", completed), enabled: completed !== null, queryFn: () => rawApi<{ completed: number; tier: Tier }>("GET", `${B}/tiers/preview?completed=${completed}`) });
export const usePrograms = () => useQuery({ queryKey: key("programs"), queryFn: () => rawApi<{ items: Program[] }>("GET", `${B}/partnerships`) });
export const useProgramCodes = (id: string | null) => useQuery({ queryKey: key("codes", id), enabled: !!id, queryFn: () => rawApi<{ items: ProgramCode[] }>("GET", `${B}/partnerships/${encodeURIComponent(id!)}/codes`) });

function useMut<V, R>(fn: (v: V) => Promise<R>) { const qc = useQueryClient(); return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: key() }) }); }
export const useCreateProgram = () => useMut((b: ProgramBody) => rawApi<Program>("POST", `${B}/partnerships`, b));
export const useLinkCampaign = () => useMut((v: { id: string; campaignId: string }) => rawApi<Program>("POST", `${B}/partnerships/${encodeURIComponent(v.id)}/campaign`, { campaignId: v.campaignId }));
export const useProgramAction = () => useMut((v: { id: string; op: "activate" | "pause" | "end" }) => rawApi<Program>("POST", `${B}/partnerships/${encodeURIComponent(v.id)}/${v.op}`, {}));
export const useCreateProgramCode = () => useMut((v: { id: string; body: { label: string; maxRedemptions: number; expiresAt?: string } }) => rawApi<CreatedCode>("POST", `${B}/partnerships/${encodeURIComponent(v.id)}/codes`, v.body));
export const useRevokeProgramCode = () => useMut((v: { id: string; codeId: string }) => rawApi<{ id: string }>("POST", `${B}/partnerships/${encodeURIComponent(v.id)}/codes/${encodeURIComponent(v.codeId)}/revoke`, {}));
