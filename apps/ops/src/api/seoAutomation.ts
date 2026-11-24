// GRW-P3-F: ops hooks over /api/v1/admin/growth/seo-automation/*.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/seo-automation";
export interface TemplateSummary { template: string; pages: number; failed: number; avgScore: number; checks: Record<string, number> }
export interface WorstPage { pageKey: string; locale: string; templateKind: string; score: number; failedChecks: string[]; noindex: boolean; checkedAt: string }
export interface SeoOverview { autoNoindex: boolean; configVersion: number | null; measured: boolean; bundleAvailable: boolean; byTemplate: TemplateSummary[]; worst: WorstPage[]; pagesChecked: number; wouldNoindex: number; links: { total: number; byRule: Array<{ rule: string; count: number }> }; orphans: string[] }
export interface VitalPointRow { templateKind: string; metric: string; source: "LAB" | "FIELD"; day: string; p75: number; sampleSize: number }
export interface VitalsView { budgets: { lcpMs: number; inpMs: number; cls: number; tbtMs: number; perfScore: number }; trend: VitalPointRow[]; latest: VitalPointRow[]; breaches: Array<{ templateKind: string; metric: string; source: string; value: number; budget: number }>; lab: { measured: boolean; note?: string }; field: { measured: boolean; note?: string; source?: string }; readiness: { productionIndexing: Array<{ key: string; ok: boolean }> } }
export interface IndexationView { rows: Array<{ templateKind: string; day: string; submitted: number; indexed: number | null; excluded: number; reasons: Record<string, unknown>; indexedKnown: boolean }>; note: string }

export const useSeoOverview = () => useQuery({ queryKey: ["growth", "seo-auto", "overview"], queryFn: () => rawApi<SeoOverview>("GET", `${B}/overview`) });
export const useSeoVitals = () => useQuery({ queryKey: ["growth", "seo-auto", "vitals"], queryFn: () => rawApi<VitalsView>("GET", `${B}/vitals`) });
export const useSeoIndexation = () => useQuery({ queryKey: ["growth", "seo-auto", "indexation"], queryFn: () => rawApi<IndexationView>("GET", `${B}/indexation`) });
export const useSeoLinks = (from: string) => useQuery({ queryKey: ["growth", "seo-auto", "links", from], queryFn: () => rawApi<{ totals?: SeoOverview["links"]; groups?: Array<{ kind: string; links: Array<{ label: { en: string; ar: string }; path: string }> }> }>("GET", `${B}/links${from ? `?from=${encodeURIComponent(from)}` : ""}`) });
export function useSeoRun() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => rawApi<Record<string, unknown>>("POST", `${B}/run`, {}), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["growth", "seo-auto"] }); } });
}
export function useVitalsIngest() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => rawApi<Record<string, unknown>>("POST", `${B}/vitals/ingest`, {}), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["growth", "seo-auto"] }); } });
}
