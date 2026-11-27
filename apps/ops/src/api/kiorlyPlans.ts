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
export interface PlansOverview {
  canChange: boolean;
  clinic: { available: boolean; code?: string; markets: ClinicMarket[]; plans: ClinicPlan[] };
  content: { version: number; config: ContentConfig; isDefault: boolean; updatedAt: string | null; updatedBy: string | null; defaults: ContentConfig };
}
export interface PricePreview { preview: true; priceVersion: number; supersedes: boolean; impact: { tenantsAffected: number; mrrDelta: string } | null }

const B = "/admin/kiorly-plans";
export const KEY = ["kiorly-plans"] as const;
export const usePlansOverview = () => useQuery({ queryKey: KEY, queryFn: () => rawApi<PlansOverview>("GET", B), refetchInterval: 60_000 });

function useChange<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }) });
}
export const usePatchPlan = () => useChange((v: { id: string; body: Record<string, unknown> }) => rawApi("PATCH", `${B}/clinic/${v.id}`, v.body));
export const usePublishPrice = () => useChange((v: { id: string; body: Record<string, unknown> }) => rawApi<PricePreview | ClinicPrice>("POST", `${B}/clinic/${v.id}/prices`, v.body));
export const useSaveContent = () => useChange((v: { version: number; config: ContentConfig }) => rawApi("PUT", `${B}/content`, v));
