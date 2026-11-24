// GRW-P4-A: funnel of the cross-product journeys. GET /api/v1/ops/growth/cross-product/funnel. Aggregate counts only, cells under 10 read "<10"; no person, clinic, specialty or fact id in any response.
import { useQuery } from "@tanstack/react-query";
import { rawApi } from "./client";

export type Masked = number | "<10";
export type EntryPoint = "RX_TO_PHARMACY" | "LAB_ORDER_TO_LAB" | "CARE_PLAN_TO_HOME_VISIT";
export interface FunnelRow {
  product: "PHARMACY" | "LAB" | "NURSE"; entryPoint: EntryPoint; offered: Masked; dismissed: Masked; continued: Masked; notContinued: Masked;
  bySourceOfFirstBooking: Record<string, Masked>; timeToContinue: Record<string, Masked>;
}
export interface Funnel { days: number; market: string; enabled: boolean; clinicVisitsCompleted: Masked; products: FunnelRow[]; rewards: "NONE"; commissionLink: "INERT" }
export const useCrossProductFunnel = (days: number) => useQuery({ queryKey: ["growth", "cross-product", "funnel", days], queryFn: () => rawApi<Funnel>("GET", `/ops/growth/cross-product/funnel?days=${days}`) });
