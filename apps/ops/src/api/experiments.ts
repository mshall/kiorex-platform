// GRW-P3-A: typed hooks over /api/v1/admin/growth/experiments. Experiments never touch money, policy or a safety surface; results are variant-level aggregates (arms under 10 units show "<10").
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/experiments";
export type ExperimentStatus = "DRAFT" | "PENDING_APPROVAL" | "RUNNING" | "STOPPED" | "CONCLUDED" | "ARCHIVED";
export type Verdict = "COLLECTING" | "SRM_DETECTED" | "GUARDRAIL_BREACH" | "NO_WINNER" | "WINNER" | "INCONCLUSIVE";
export interface Variant { key: string; weightBp: number }
export interface Guardrail { metric: string; marginAbs: number }
export interface Experiment {
  id: string; market: string; key: string; name: string; surface: string; hypothesis: string; status: ExperimentStatus; variants: Variant[]; allocationBp: number; eligibility: Record<string, unknown>;
  primaryMetric: string; guardrails: Guardrail[]; mode: "FIXED" | "SEQUENTIAL"; alphaBp: number; minSample: number; plannedDays: number; startedAt: string | null; stoppedAt: string | null; stopReason: string | null;
  createdBy: string; approvedBy: string | null; flagKey: string | null; createdAt: string;
}
export type MaskedN = number | "<10";
export interface Arm { variant: string; n: MaskedN; x: MaskedN; rate: number | null }
export interface TreatmentResult { variant: string; diff: number; relativeLift: number | null; ci: { low: number; high: number }; pValue: number; pAdjusted: number; pAlwaysValid: number | null; significant: boolean; direction: "UP" | "DOWN" | "FLAT" }
export interface ResultPayload { hidden?: boolean; arms?: Arm[]; srm?: { chi2: number; pValue: number; detected: boolean }; blockers?: string[]; dayNumber?: number; treatments?: TreatmentResult[]; guardrails?: Array<{ metric: string; breach: boolean; observedDiff: number; pAlwaysValid: number }>; winner?: string | null }
export interface ExperimentResult { id: string; experimentId: string; computedAt: string; dayNumber: number; verdict: Verdict; srmP: number | null; payload: ResultPayload }
export interface ExperimentEvent { id: string; experimentId: string; at: string; kind: string; actor: string; reason: string | null; diff: Record<string, unknown> }
export interface ExperimentDetail extends Experiment { latestResult: ExperimentResult | null; events: ExperimentEvent[] }
export interface Catalog { surfaces: Array<{ key: string; label: string; units: string[]; ssr: boolean; platforms: string[] }>; metrics: Array<{ key: string; event: string; harmful: boolean; kind: "PRIMARY" | "GUARDRAIL" | "BOTH" }>; policy: { minRunDays: number; srmAlpha: number; maxConcurrentPerSurface: number; kAnonymity: number } }
export type Draft = { key: string; name: string; surface: string; hypothesis: string; variants: Variant[]; allocationBp: number; primaryMetric: string; guardrails: Guardrail[]; mode: "FIXED" | "SEQUENTIAL"; plannedDays: number; baselineRate?: number; mdeAbs?: number };

const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ""; };
export const useExperiments = (f: { status?: string } = {}) => useQuery({ queryKey: ["growth", "experiments", f], queryFn: () => rawApi<Experiment[]>("GET", `${B}${qs(f)}`) });
export const useExperiment = (id: string | null) => useQuery({ queryKey: ["growth", "experiment", id], enabled: !!id, queryFn: () => rawApi<ExperimentDetail>("GET", `${B}/${id}`) });
export const useExperimentHistory = (id: string | null) => useQuery({ queryKey: ["growth", "experiment-history", id], enabled: !!id, queryFn: () => rawApi<ExperimentEvent[]>("GET", `${B}/${id}/history`) });
export const useExperimentCatalog = () => useQuery({ queryKey: ["growth", "experiment-catalog"], staleTime: 300_000, queryFn: () => rawApi<Catalog>("GET", `${B}/catalog`) });

export function useExperimentActions() {
  const qc = useQueryClient(); const done = () => qc.invalidateQueries({ queryKey: ["growth"] });
  return {
    create: useMutation({ mutationFn: (b: Draft) => rawApi<Experiment>("POST", B, b), onSuccess: done }),
    submit: useMutation({ mutationFn: (id: string) => rawApi<Experiment>("POST", `${B}/${id}/submit`), onSuccess: done }),
    approve: useMutation({ mutationFn: (id: string) => rawApi<Experiment>("POST", `${B}/${id}/approve`), onSuccess: done }),
    stop: useMutation({ mutationFn: (v: { id: string; reason: string }) => rawApi<Experiment>("POST", `${B}/${v.id}/stop`, { reason: v.reason }), onSuccess: done }),
    archive: useMutation({ mutationFn: (id: string) => rawApi<Experiment>("POST", `${B}/${id}/archive`), onSuccess: done }),
    ship: useMutation({ mutationFn: (id: string) => rawApi<{ requested: boolean; duplicate: boolean; proposal: Record<string, unknown> }>("POST", `${B}/${id}/ship-winner`), onSuccess: done }),
  };
}
