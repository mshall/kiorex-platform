// GRW-P3-C: typed hooks over /api/v1/admin/growth/cohorts. Aggregate, k >= 10 masked, no person data in any response.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/cohorts";
export type Masked = number | "<10";
export type Basis = "FIRST_COMPLETED" | "REGISTRATION";
export type Dimension = "ALL" | "SOURCE" | "CAMPAIGN" | "PLATFORM";
export interface CohortMonthCell { monthIndex: number; retained: Masked; completedBookings: Masked; revenueMinor: Masked; rewardCostMinor: Masked }
export type CohortRow = { cohortMonth: string; suppressed: true; patients: "<10"; months: [] } | { cohortMonth: string; suppressed: false; patients: number; months: CohortMonthCell[] };
export interface CohortTable { market: string; basis: Basis; dimension: Dimension; value: string | null; k: number; rows: CohortRow[]; visitsPerPatientM3: number | null; note: string }
export interface RetentionDto { market: string; basis: Basis; dimension: Dimension; value: string | null; k: number; rows: Array<{ cohortMonth: string; patients: number | "<10"; suppressed: boolean; cells: Array<{ monthIndex: number; retained: Masked; rate: number | "<10" | null }> }> }
export interface LtvRow { dimension: Dimension; value: string | null; horizonMonths: number; estimateMinor: number; lowMinor: number; highMinor: number; n: number; label: "ESTIMATE"; computedAt: string }
export interface LtvDto { market: string; label: "ESTIMATE"; modelVersion: string; policy: { version: number | null; source: string; horizonMonths: number; discountRateBp: number; includeRewardCost: boolean; intervalPercent: number; resamples: number }; rows: LtvRow[]; method: string }
export type PaybackRow = { cohortMonth: string; suppressed: true } | { cohortMonth: string; suppressed: false; patients: number; spendMinor: number | null; cacMinor: number | null; paybackMonth: number | null; observedMonths: number; cumulativePerPatientMinor: number[] };
export interface PaybackDto { market: string; rows: PaybackRow[]; blendedCacMinor: number | null; ltvToCac: { estimate: number; low: number; high: number; n: number; label: "ESTIMATE" } | null; note: string; horizonMonths: number }

const qs = (o: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ""; };
export const useCohortValues = (dimension: Dimension) => useQuery({ queryKey: ["growth", "cohort-values", dimension], enabled: dimension !== "ALL", queryFn: () => rawApi<{ values: string[] }>("GET", `${B}/values${qs({ dimension })}`) });
export const useCohortTable = (r: { basis: Basis; dimension: Dimension; value?: string }) => useQuery({ queryKey: ["growth", "cohorts", r], enabled: r.dimension === "ALL" || !!r.value, queryFn: () => rawApi<CohortTable>("GET", `${B}${qs({ basis: r.basis, dimension: r.dimension, value: r.value })}`) });
export const useCohortRetention = (r: { basis: Basis; dimension: Dimension; value?: string }) => useQuery({ queryKey: ["growth", "cohort-retention", r], enabled: r.dimension === "ALL" || !!r.value, queryFn: () => rawApi<RetentionDto>("GET", `${B}/retention${qs({ basis: r.basis, dimension: r.dimension, value: r.value })}`) });
export const useLtv = () => useQuery({ queryKey: ["growth", "ltv"], queryFn: () => rawApi<LtvDto>("GET", `${B}/ltv`) });
export const usePayback = () => useQuery({ queryKey: ["growth", "payback"], queryFn: () => rawApi<PaybackDto>("GET", `${B}/payback`) });
export function useCohortRollup() { const qc = useQueryClient(); return useMutation({ mutationFn: (months: number) => rawApi<Record<string, unknown>>("POST", `${B}/rollup`, { months }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["growth"] }) }); }
