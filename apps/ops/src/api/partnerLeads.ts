import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

export type LeadStatus = "NEW" | "CONTACTED" | "STARTED" | "SUBMITTED" | "LIVE" | "CLOSED";
export interface LeadRow {
  id: string; kind: "CLINIC" | "NURSE" | "PHARMACY" | "LAB"; orgRef: string; orgName: string; contactName: string; contactRole: string | null; phone: string | null; email: string | null;
  preferredTime: string | null; note: string | null; locale: string; market: string; consentAt: string; status: LeadStatus; assignee: string | null;
  notes: Array<{ at: string; by: string; text: string }>; connectionId: string | null; connectionStatus: string | null; createdAt: string; updatedAt: string;
}
export interface FunnelDto { days: number; talkToUs: number; stages: Array<{ stage: "interested" | "started" | "submitted" | "live"; count: number; fromPrevious: number | null; fromInterested: number | null }>; byKind: Record<string, { interested: number; started: number; submitted: number; live: number }> }
const B = "/admin/partner-leads";
export const LEAD_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "STARTED", "SUBMITTED", "LIVE", "CLOSED"];

export const usePartnerLeads = (status: string, kind: string) => useQuery({ queryKey: ["leads", "list", status, kind], queryFn: () => rawApi<LeadRow[]>("GET", `${B}?${new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}) })}`), refetchInterval: 20_000 });
export const useLeadFunnel = (days: number) => useQuery({ queryKey: ["leads", "funnel", days], queryFn: () => rawApi<FunnelDto>("GET", `${B}/funnel?days=${days}`) });
export function useLeadAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; patch?: { status?: string; assignee?: string | null }; note?: string }) => v.note !== undefined ? rawApi<LeadRow>("POST", `${B}/${v.id}/notes`, { text: v.note }) : rawApi<LeadRow>("PATCH", `${B}/${v.id}`, v.patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}
