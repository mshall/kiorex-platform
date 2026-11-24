// GRW-P3-G: typed hooks over /api/v1/admin/growth/market-onboarding. Reference data and ids only: legal texts, prices and fees never travel here.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/market-onboarding";
export type StepId = "identity" | "geography" | "specialties" | "regulation" | "providers" | "consent" | "residency" | "integrations";
export type ReadinessStatus = "DONE" | "TODO" | "AWAITING_CHECKER" | "NEEDS_HUMAN";
export interface Plan { cc: string; status: "DRAFT" | "READY" | "PUBLISHED" | "CANCELLED"; steps: Partial<Record<StepId, Record<string, unknown>>>; createdBy: string; createdAt: string; updatedAt: string }
export interface Catalogue { steps: StepId[]; dataCells: { cells: string[]; source: string; deployed: string[]; bindings: Record<string, string> }; existing: string[]; specialties: Array<{ code: string; en: string; ar: string }> }
export interface ReadinessItem { id: string; status: ReadinessStatus; detail: string; humanOwner?: string }
export interface Readiness { cc: string; status: string; items: ReadinessItem[]; ready: boolean; live: boolean; todo: number; needsHuman: number; dataCell: string | null; sameCellMarkets: string[] }
export interface GeoPreview { ok: boolean; errors: Array<{ line: number; code: string; message: string }>; cities: number; districts: number; totalLines: number; truncatedErrors?: boolean; sample: Array<{ level: string; key: string; parentKey: string; nameAr: string; nameEn: string; slugAr: string; slugEn: string }> }
export interface PublishResult { cc: string; drafted: Record<string, { id: string; version: number; status: string }>; flag: string; next: string }

export const useCatalogue = () => useQuery({ queryKey: ["growth", "mo-catalogue"], queryFn: () => rawApi<Catalogue>("GET", `${B}/catalogue`), staleTime: 60_000 });
export const usePlans = () => useQuery({ queryKey: ["growth", "mo-plans"], queryFn: () => rawApi<Plan[]>("GET", `${B}/plans`) });
export const useReadiness = (cc: string | null) => useQuery({ queryKey: ["growth", "mo-readiness", cc], enabled: !!cc, queryFn: () => rawApi<Readiness>("GET", `${B}/plans/${cc}/readiness`) });
const useInvalidate = () => { const qc = useQueryClient(); return () => void qc.invalidateQueries({ queryKey: ["growth"] }); };
export function useCreatePlan() { const inv = useInvalidate(); return useMutation({ mutationFn: (cc: string) => rawApi<Plan>("POST", `${B}/plans`, { cc }), onSuccess: inv }); }
export function useSaveStep(cc: string) { const inv = useInvalidate(); return useMutation({ mutationFn: (v: { step: StepId; body: Record<string, unknown> }) => rawApi<Plan>("PUT", `${B}/plans/${cc}/steps/${v.step}`, v.body), onSuccess: inv }); }
export function useGeographyPreview() { return useMutation({ mutationFn: (v: { csv?: string; csvBase64?: string; encoding?: string }) => rawApi<GeoPreview>("POST", `${B}/geography/preview`, v) }); }
export function useGeographyImport(cc: string) { const inv = useInvalidate(); return useMutation({ mutationFn: (v: { csv?: string; csvBase64?: string; encoding?: string }) => rawApi<{ cities: number; districts: number }>("POST", `${B}/plans/${cc}/geography`, v), onSuccess: inv }); }
export function usePublishPlan(cc: string) { const inv = useInvalidate(); return useMutation({ mutationFn: () => rawApi<PublishResult>("POST", `${B}/plans/${cc}/publish`, {}), onSuccess: inv }); }
