import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

/** Kiorly admin and Kiorex console, Plans. The Clinic owns plans and prices (this is the audited door to them); the Pharmacy and Lab site text is saved in the Kiorex API. Nothing is kept here beyond the query cache. */
export interface L10n { en: string; ar: string }
export interface L10nLines { en: string[]; ar: string[] }
export interface ClinicPrice { id: string; planId: string; marketId: string; currency: string; interval: "MONTHLY" | "ANNUAL"; unit: "PER_TENANT" | "PER_CLINICIAN"; amount: string; includedClinicians: number; extraClinicianAmount: string | null; cohortKey: string | null; priceVersion: number; validFrom: string; validTo: string | null }
export interface ClinicPlan { id: string; key: string; nameEn: string; nameAr: string; isPublic: boolean; sortOrder: number; entitlements: Array<{ key: string; value: unknown }>; prices: ClinicPrice[] }
export interface ClinicMarket { id: string; code: string; nameEn: string; defaultCurrency: string }
export interface ContentPlan { id: string; visible: boolean; name: L10n; summary: L10n; limits: L10nLines; features: L10nLines }
export interface ContentConfig { pharmacy: { plans: ContentPlan[] }; lab: { plans: ContentPlan[] } }
export type PriceProduct = "CLINIC" | "PHARMACY" | "LAB";
export interface ProductPrice { id: string; edition: string; marketCode: string; interval: "MONTHLY" | "ANNUAL"; currency: string; amount: string; validFrom: string; validTo: string | null; priceVersion: number; proposalId: string | null; proposedBy: string | null; publishedBy: string | null; createdAt: string }
export interface ProductPrices { available: boolean; configured: boolean; code?: string; editions: string[]; prices: ProductPrice[]; organisations: Array<{ edition: string; marketCode: string; count: number }> }
export interface PriceWarning { code: string; params: Record<string, string | number> }
export type ProposalStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
export interface PreviewResult { priceVersion: number; supersedes: boolean; validFrom: string; affected: number; mrrDelta: string | null; from: { amount: string; currency: string; priceVersion: number } | null }
export interface PriceProposal {
  id: string; product: PriceProduct; planRef: string; planKey: string; marketCode: string; interval: "MONTHLY" | "ANNUAL"; unit: "PER_TENANT" | "PER_CLINICIAN"; currency: string; amount: string;
  includedClinicians: number | null; extraClinicianAmount: string | null; effectiveFrom: string; requestedFrom: string | null; note: string | null; status: ProposalStatus; warnings: PriceWarning[]; preview: PreviewResult;
  proposedBy: string; proposedByEmail: string | null; proposedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; publishedVersion: number | null; lastError: string | null; lastAttemptAt: string | null;
}
export interface PlansOverview {
  canChange: boolean;
  clinic: { available: boolean; code?: string; markets: ClinicMarket[]; plans: ClinicPlan[] };
  content: { version: number; config: ContentConfig; isDefault: boolean; updatedAt: string | null; updatedBy: string | null; defaults: ContentConfig };
  pharmacy?: ProductPrices;
  lab?: ProductPrices;
  proposals?: PriceProposal[];
  capabilities?: { canPropose: boolean; canApprove: boolean; you: string };
  catalogueWarnings?: Array<PriceWarning & { product: PriceProduct; planKey: string; market: string; interval: string; unit: string }>;
}
export interface PriceCheck { input: Record<string, unknown>; preview: PreviewResult; warnings: PriceWarning[] }
export interface PricePreview { preview: true; priceVersion: number; supersedes: boolean; impact: { tenantsAffected: number; mrrDelta: string } | null }

const B = "/admin/kiorly-plans";
export const KEY = ["kiorly-plans"] as const;
export const usePlansOverview = () => useQuery({ queryKey: KEY, queryFn: () => rawApi<PlansOverview>("GET", B), refetchInterval: 60_000 });

function useChange<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }) });
}
export const usePatchPlan = () => useChange((v: { id: string; body: Record<string, unknown> }) => rawApi("PATCH", `${B}/clinic/${v.id}`, v.body));
export const usePreviewPrice = () => useMutation({ mutationFn: (body: Record<string, unknown>) => rawApi<PriceCheck>("POST", `${B}/prices/preview`, body) });
export const useProposePrice = () => useChange((body: Record<string, unknown>) => rawApi<PriceProposal>("POST", `${B}/proposals`, body));
export const useDecideProposal = () => useChange((v: { id: string; action: "approve" | "reject" | "withdraw"; note?: string }) => rawApi<PriceProposal>("POST", `${B}/proposals/${v.id}/${v.action}`, v.note ? { note: v.note } : {}));
export const useSaveContent = () => useChange((v: { version: number; config: ContentConfig }) => rawApi("PUT", `${B}/content`, v));
