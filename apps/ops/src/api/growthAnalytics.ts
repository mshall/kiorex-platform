// Growth analytics v1 (GRW-P1-J): typed hooks over /api/v1/ops/growth-analytics/*. Every figure arrives k-anonymised (k >= 10): a number or the string "<10".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi, rawText } from "./client";

const B = "/ops/growth-analytics";
export type Masked = number | "<10";
export const FILTER_KEYS = ["country", "city", "district", "specialty", "provider", "doctor", "branch", "campaign", "channel"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export interface Filters { from: string; to: string; country?: string; city?: string; district?: string; specialty?: string; provider?: string; doctor?: string; branch?: string; campaign?: string; channel?: string }
const qs = (f: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ""; };

export interface Overview {
  period: { from: string; to: string }; filters: Record<string, string>; audience: string; k: number; freshness: { rolledUpAt: string | null; lastEventAt: string | null };
  bookings: Masked; attendedNewPatients: Masked; feeBearingNewPatients: Masked; providerLedShare: Masked | null; originMix: { providerLed: Masked; marketplace: Masked; unattributed: Masked };
  bookingToAttended: Masked | null; searchToBooking: Masked | null;
  grossBookingValueMinor?: Masked; grossBookingValue?: { isRevenue: false; note: string }; kiorexRevenueMinor?: Masked; commissionPendingMinor?: Masked; revenueNote?: string;
  spendMinor?: number; blendedCacMinor?: Masked | null; merRatio?: Masked | null; ltvMinor?: number; coverage: { visitorStageAvailable: boolean; note?: string }; masked: boolean;
}
export interface FunnelStage { stage: string; count: Masked; masked: boolean; kind: "VISITOR_STREAM" | "BOOKING_FACT"; stepConversionPct: Masked | null; cumulativeConversionPct: Masked | null }
export interface Funnel { period: { from: string; to: string }; stages: FunnelStage[]; coverage: { visitorStageAvailable: boolean }; freshness: Overview["freshness"] }
export interface ChannelRow { sourceKind?: string; campaign?: string; bookings: Masked; attendedNewPatients: Masked; spendMinor?: number; revenueMinor?: Masked; cacMinor?: Masked | null; roas?: Masked | null; ltvToCac?: Masked | null; verdict?: string; masked: boolean }
export interface CohortRow { cohort: string; size: Masked; masked: boolean; retention30Pct: Masked | null; retention90Pct: Masked | null; retention180Pct: Masked | null }
export type BreakdownRow = Record<string, unknown> & { bookings: Masked; attendedNewPatients: Masked; providerLedSharePct: Masked | null; masked: boolean }
export interface SpendEntry { id: string; day: string; campaign: string; channel: string; sourceKind: string; amountMinor: number; currency: string; note: string; status: "PENDING" | "APPROVED" | "REJECTED"; createdBy: string; decidedBy: string | null }

const key = (name: string, f: object, extra?: unknown) => ["growth-analytics", name, f, extra] as const;
export const useOverview = (f: Filters) => useQuery({ queryKey: key("overview", f), queryFn: () => rawApi<Overview>("GET", `${B}/overview${qs({ ...f })}`) });
export const useFunnel = (f: Filters) => useQuery({ queryKey: key("funnel", f), queryFn: () => rawApi<Funnel>("GET", `${B}/funnel${qs({ ...f })}`) });
export const useChannels = (f: Filters, by: "sourceKind" | "campaign" = "sourceKind") => useQuery({ queryKey: key("channels", f, by), queryFn: () => rawApi<{ rows: ChannelRow[]; freshness: Overview["freshness"] }>("GET", `${B}/channels${qs({ ...f, by })}`) });
export const useCohorts = (f: Filters) => useQuery({ queryKey: key("cohorts", f), queryFn: () => rawApi<{ rows: CohortRow[]; observation: string }>("GET", `${B}/cohorts${qs({ ...f })}`) });
export const useBreakdown = (dim: string, f: Filters, enabled = true) => useQuery({ queryKey: key("breakdown", f, dim), enabled, queryFn: () => rawApi<{ rows: BreakdownRow[] }>("GET", `${B}/breakdown/${dim}${qs({ ...f })}`) });
export const useSpend = () => useQuery({ queryKey: ["growth-analytics", "spend"], queryFn: () => rawApi<SpendEntry[]>("GET", `${B}/spend`) });
export function useSpendMutations() {
  const qc = useQueryClient(); const done = () => { void qc.invalidateQueries({ queryKey: ["growth-analytics"] }); };
  return {
    create: useMutation({ mutationFn: (b: { day: string; amountMinor: number; campaign?: string; channel?: string; sourceKind?: string; note?: string }) => rawApi<SpendEntry>("POST", `${B}/spend`, b), onSuccess: done }),
    decide: useMutation({ mutationFn: (v: { id: string; decision: "approve" | "reject" }) => rawApi<SpendEntry>("POST", `${B}/spend/${v.id}/${v.decision}`, {}), onSuccess: done }),
  };
}
/** CSV with the same masking as the screens; saved through a Blob. */
export async function downloadCsv(report: string, f: Filters, dimension?: string) {
  const text = await rawText(`${B}/export/${report}.csv${qs({ ...f, dimension })}`);
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = `growth-${report}-${f.from}-${f.to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
