// GRW-P2-F: typed hooks over /api/v1/admin/growth/{integration-status,integration-runs,integrations/:kind/*,channel-performance}. Nothing here sends or receives a secret.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth";
const qs = (o: Record<string, string | number | undefined | null>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ""; };

export type Masked = number | "<10";
export interface IntegrationRow {
  kind: string; label: string; mode: "mock" | "real"; flagEffective: boolean; flagReason: string; secretRefSet: boolean; secretRefConfigured: boolean; accountLabelSet: boolean; pullSchedule: string; rateBudgetPerHour: number;
  retentionMonths: number; location: string; fallback: string; defaultOff: boolean; circuit: "CLOSED" | "OPEN" | "HALF_OPEN"; consecutiveFailures: number; lastOkAt: string | null; lastErrorAt: string | null;
  lastRun: { id: string; status: string; mode: string; rows: number; error: string | null; startedAt: string } | null; health: { ok: boolean; detail: string }; connected: boolean; synthetic: boolean;
}
export interface IntegrationStatus { market: string; integrations: IntegrationRow[]; rules: { secrets: string; data: string; conversions: string } }
export interface IntegrationRun { id: string; kind: string; mode: string; status: "OK" | "PARTIAL" | "FAILED"; rows: number; error: string | null; windowFrom: string | null; windowTo: string | null; startedAt: string; finishedAt: string | null }

export const useIntegrationStatus = (market: string) => useQuery({ queryKey: ["growth", "integration-status", market], queryFn: () => rawApi<IntegrationStatus>("GET", `${B}/integration-status${qs({ market })}`) });
export const useIntegrationRuns = (market: string, kind?: string) => useQuery({ queryKey: ["growth", "integration-runs", market, kind], queryFn: () => rawApi<IntegrationRun[]>("GET", `${B}/integration-runs${qs({ market, kind, take: 30 })}`) });
export function useIntegrationActions(market: string) {
  const qc = useQueryClient(); const done = () => void qc.invalidateQueries({ queryKey: ["growth"] });
  return {
    test: useMutation({ mutationFn: (kind: string) => rawApi<{ kind: string; mode: string; ok: boolean; detail: string }>("POST", `${B}/integrations/${kind}/test${qs({ market })}`) }),
    run: useMutation({ mutationFn: (v: { kind: string; requestId?: string }) => rawApi<{ status: string; rows: number; reason?: string }>("POST", `${B}/integrations/${v.kind}/run`, { market, requestId: v.requestId }), onSuccess: done }),
    request: useMutation({ mutationFn: (kind: string) => rawApi<{ requestId: string }>("POST", `${B}/integrations/${kind}/run-requests`, { market }) }),
  };
}

export interface Ratio { value: number | "<10" | null; hidden: string | null }
export interface ChannelRow { kind: string; label: string; connected: boolean; synthetic: boolean; lastRunAt: string | null; paid: boolean; metrics: { spendMinor: number | null; impressions: number | null; clicks: number | null; conversions: number | null; ctrPct: number | null; cpcMinor: number | null; cpmMinor: number | null } | null }
export interface CampaignPerfRow {
  key: string; campaignId: string | null; name: string | null; status: string | null; synthetic: boolean;
  external: { spendMinor: number; impressions: number; clicks: number; conversions: number; cpcMinor: number | null; ctrPct: number | null } | null;
  firstParty: { attendedNewPatients: Masked; bookingsConfirmed: Masked };
  spend: { approvedMinor: number; externalMinor: number | null; usedMinor: number; source: string; deltaBp: number | null; conflict: boolean; note: string };
  cacMinor: number | "<10" | null; cacHidden: string | null; roas: number | "<10" | null; roasHidden: string | null; revenueToDateMinor: number | "<10" | null;
}
export interface ChannelPerformance {
  market: string; range: { from: string; to: string }; currency: string; kMin: number; spendFloorMinor: number; definitions: Record<string, string>;
  channels: ChannelRow[]; campaigns: CampaignPerfRow[]; mix: Array<{ key: string; count: Masked }>;
  blended: { spendMinor: number; rewardCostMinor: number; attendedNewPatients: Masked; cacWithoutRewardsMinor: number | "<10" | null; cacWithRewardsMinor: number | "<10" | null; hidden: string | null; merHidden: string | null; mer: number | "<10" | null };
  appFunnel: { storeConnected: boolean; installsStore: number | null; listingViews: number | null; installsFirstParty: Masked; registrations: Masked; firstCompletedBookings: Masked; installToRegistrationPct: number | null; registrationToFirstBookingPct: number | null };
  organic: Array<{ template: string; clicks: number; impressions: number; ctrPct: number | null }>; vitals: Array<{ metric: string; byTemplate: Array<{ template: string; value: number }> }>;
  notConnected: string[]; gaps: string[];
}
export const useChannelPerformance = (market: string, days: number) => useQuery({
  queryKey: ["growth", "channel-performance", market, days],
  queryFn: () => { const to = new Date().toISOString().slice(0, 10); const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10); return rawApi<ChannelPerformance>("GET", `${B}/channel-performance${qs({ market, from, to })}`); },
});
