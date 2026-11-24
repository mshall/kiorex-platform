// GRW-P3-B: typed hooks over /api/v1/admin/growth/attribution-models. Aggregate, k >= 10 masked, no person data in any response.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/attribution-models";
export type Masked = number | "<10";
export type ModelKey = "LAST_TOUCH" | "LAST_NON_DIRECT" | "FIRST_TOUCH" | "LINEAR" | "TIME_DECAY" | "POSITION_BASED" | "DATA_DRIVEN";
export interface ModelRowDto { sourceKind: string; paths: Masked; masked: boolean; conversions: Masked; revenueMinor: Masked }
export interface ModelBlock { model: ModelKey; available: boolean; isDefault: boolean; total: { conversions: number; revenueMinor: number }; rows: ModelRowDto[] }
export interface ModelComparison { market: string; from: string; to: string; defaultModel: ModelKey; models: ModelBlock[]; reconciled: boolean; dataDriven: { status: "OK" | "INSUFFICIENT_VOLUME"; message?: string; conversions90d: number; needed: number }; note: string }
export interface PathsDto { market: string; from: string; to: string; k: number; paths: Array<{ pathHash: string; length: number; kinds: string[]; conversions: number }>; lengthDistribution: Array<{ length: number; conversions: number }> }
export type LiftDto = { experimentKey: string; available: false; reason: string; message: string } | { experimentKey: string; available: true; status: string; lift: { label: string; holdout: { exposures: number; conversions: number; rate: number }; exposed: { exposures: number; conversions: number; rate: number }; absoluteLiftPp: number; relativeLiftPct: number | null; ciLowPp: number; ciHighPp: number; pValue: number; significant: boolean } };

const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ""; };
export const useModelComparison = (r: { from?: string; to?: string }) => useQuery({ queryKey: ["growth", "attribution-models", r], queryFn: () => rawApi<ModelComparison>("GET", `${B}${qs(r)}`) });
export const useModelPaths = (r: { from?: string; to?: string }) => useQuery({ queryKey: ["growth", "attribution-paths", r], queryFn: () => rawApi<PathsDto>("GET", `${B}/paths${qs(r)}`) });
export const useModelLift = (key: string) => useQuery({ queryKey: ["growth", "attribution-lift", key], enabled: key.length >= 2, retry: false, queryFn: () => rawApi<LiftDto>("GET", `${B}/lift${qs({ experimentKey: key })}`) });
export function useModelRollup() { const qc = useQueryClient(); return useMutation({ mutationFn: (days: number) => rawApi<Record<string, unknown>>("POST", `${B}/rollup`, { days }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["growth"] }) }); }
