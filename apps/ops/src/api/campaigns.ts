// Campaign management (GRW-P2-A): typed hooks over /api/v1/admin/growth/campaigns. Campaigns are PLANS: nothing here reaches an ad platform.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/campaigns";
const qs = (o: Record<string, string | number | boolean | undefined | null>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ""; };

export type CampaignStatus = "DRAFT" | "PENDING_APPROVAL" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
export const OBJECTIVES = ["AWARENESS", "ACQUISITION", "REACTIVATION", "PROMOTION", "APP_INSTALL", "PROVIDER_GROWTH"] as const;
export const CHANNELS = ["ORGANIC_SEARCH", "EMAIL", "SMS", "WHATSAPP", "PUSH", "IN_APP", "PARTNER", "PAID_SEARCH", "PAID_SOCIAL", "PAID_VIDEO", "OFFLINE", "REFERRAL"] as const;
export interface CampaignBrief { id: string; market: string; key: string; utmCampaign: string; name: string; objective: string; status: CampaignStatus; channels: string[]; budgetTotalMinor: number; budgetDailyMinor: number; currency: string; startsAt: string | null; endsAt: string | null; ownerSub: string; pauseReason: string | null; version: number; createdAt: string; approvedSpendMinor?: number; utilisationBp?: number }
export interface CampaignAction { to: CampaignStatus; allowed: boolean; code?: string; message?: string }
export interface Campaign extends CampaignBrief {
  eligibility: Record<string, unknown>; utmConfig: Record<string, unknown>; landingPageId: string | null; policyVersionId: string; activatedAt: string | null; completedAt: string | null; archivedAt: string | null; autoExpiresAt: string | null; pausedUntil: string | null; statusReason: string | null; thresholdsFiredBp: number[];
  links: { webUrl: string; appLink: string; landingPath: string; utm: Record<string, string> };
  approval: { required: boolean; reasons: string[]; current: boolean; payloadHash: string; pending: Array<{ id: string; kind: string; requestedBy: string; requestedAt: string }> };
  budget: { approvedSpendMinor: number; pendingSpendMinor: number; utilisationBp: number; remainingMinor: number };
  actions: CampaignAction[];
}
export interface Approval { id: string; campaignId: string; kind: "ACTIVATE" | "BUDGET_INCREASE" | "REACTIVATE"; requestedBy: string; requestedAt: string; decidedBy: string | null; decidedAt: string | null; decision: "APPROVED" | "REJECTED" | null; reason: string | null; snapshot: { payload: Record<string, unknown>; note: string | null }; snapshotHash: string; campaign?: { id: string; key: string; name: string; status: string; market: string; budgetTotalMinor: number; currency: string; channels: string[] } }
export type Masked = number | "<10";
export interface Report {
  campaign: CampaignBrief; range: { from: string; to: string };
  budget: { totalMinor: number; dailyMinor: number; approvedSpendMinor: number; pendingSpendMinor: number; utilisationBp: number; currency: string };
  funnel: Array<{ stage: string; count: Masked; masked: boolean }>;
  kpis: { cpa: { count: Masked; masked: boolean; values: { cpaMinor: Masked | null; conversionPct: Masked | null } }; cac: { count: Masked; masked: boolean; values: { cacMinor: Masked | null } }; roas: { count: Masked; masked: boolean; values: { roas: Masked | null } }; kMin: number; mask: string };
  revenue: { netMinor: number | null; masked: boolean; restricted?: boolean; note: string };
  daily: Array<{ day: string; spendMinor: number; pageViews: Masked; bookingsConfirmed: Masked }>;
  bySource: Array<{ sourceKind: string; pageViews: Masked; bookingsConfirmed: Masked }>;
  external: { connected: boolean; kinds: string[]; metrics: Record<string, number> };
}
export interface HistoryRow { id: string; from: string; to: string; actor: string; reasonCode: string; at: string }
export interface Creative { id: string; kind: string; assetRef: string; locale: string; status: string; checksum: string | null; createdBy: string; createdAt: string }
export interface SpendRow { id: string; day: string; amountMinor: number; status: string; createdBy: string; decidedBy: string | null; note: string; source: string }
export interface CreateBody { key: string; name: string; objective: string; budgetTotalMinor: number; budgetDailyMinor?: number; channels: string[]; startsAt?: string; endsAt?: string; eligibility?: Record<string, unknown>; utmConfig?: Record<string, unknown>; landingPageId?: string }

const inv = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ queryKey: ["campaigns"] });
export const useCampaigns = (f: { status?: string; q?: string; promotional?: boolean }) => useQuery({ queryKey: ["campaigns", "list", f], queryFn: () => rawApi<CampaignBrief[]>("GET", `${B}${qs({ ...f, promotional: f.promotional ? 1 : undefined })}`) });
export const useCampaign = (id: string | undefined) => useQuery({ queryKey: ["campaigns", "one", id], enabled: !!id, queryFn: () => rawApi<Campaign>("GET", `${B}/${id}`) });
export const useCampaignReport = (id: string | undefined, from?: string, to?: string) => useQuery({ queryKey: ["campaigns", "report", id, from, to], enabled: !!id, queryFn: () => rawApi<Report>("GET", `${B}/${id}/report${qs({ from, to })}`) });
export const useCampaignHistory = (id: string | undefined) => useQuery({ queryKey: ["campaigns", "history", id], enabled: !!id, queryFn: () => rawApi<HistoryRow[]>("GET", `${B}/${id}/history`) });
export const useCampaignCreatives = (id: string | undefined) => useQuery({ queryKey: ["campaigns", "creatives", id], enabled: !!id, queryFn: () => rawApi<Creative[]>("GET", `${B}/${id}/creatives`) });
export const useCampaignSpend = (id: string | undefined) => useQuery({ queryKey: ["campaigns", "spend", id], enabled: !!id, queryFn: () => rawApi<{ entries: SpendRow[]; daily: Array<{ day: string; plannedMinor: number; approvedSpendMinor: number; pendingSpendMinor: number; utilisationBp: number }> }>("GET", `${B}/${id}/spend`) });
export const useApprovals = (status: "pending" | "decided" | undefined) => useQuery({ queryKey: ["campaigns", "approvals", status], queryFn: () => rawApi<Approval[]>("GET", `${B}/approvals${qs({ status })}`) });

export function useCampaignActions() {
  const qc = useQueryClient();
  const useAction = <V, R = unknown>(fn: (v: V) => Promise<R>) => useMutation({ mutationFn: fn, onSuccess: () => inv(qc) });
  return {
    create: useAction((b: CreateBody) => rawApi<Campaign>("POST", B, b)),
    update: useAction((v: { id: string; version: number } & Partial<CreateBody>) => { const { id, ...body } = v; return rawApi<Campaign>("PATCH", `${B}/${id}`, body); }),
    transition: useAction((v: { id: string; to: CampaignStatus; reason?: string; reasonCode?: string }) => rawApi<Campaign>("POST", `${B}/${v.id}/transition`, { to: v.to, reason: v.reason, reasonCode: v.reasonCode })),
    requestApproval: useAction((v: { id: string; kind: Approval["kind"]; budgetTotalMinor?: number; budgetDailyMinor?: number; note?: string }) => { const { id, ...body } = v; return rawApi<Approval>("POST", `${B}/${id}/approvals`, body); }),
    decide: useAction((v: { id: string; decision: "APPROVED" | "REJECTED"; snapshotHash: string; reason?: string }) => { const { id, ...body } = v; return rawApi<Approval>("POST", `${B}/approvals/${id}/decide`, body); }),
    addCreative: useAction((v: { id: string; kind: string; assetRef: string; locale?: string }) => { const { id, ...body } = v; return rawApi<Creative>("POST", `${B}/${id}/creatives`, body); }),
    addSpend: useAction((v: { id: string; day: string; amountMinor: number; note?: string }) => { const { id, ...body } = v; return rawApi<SpendRow>("POST", `${B}/${id}/spend`, body); }),
    runScheduler: useAction(() => rawApi<Record<string, number>>("POST", `${B}/scheduler/run`)),
  };
}
