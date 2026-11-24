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

// ── lead alerts (who is told, unread badge) ──
export type AlertChannel = "EMAIL" | "WHATSAPP" | "PUSH";
export interface AlertRecipient { sub: string; name: string | null; roles: string[]; leadAlerts: boolean; channels: AlertChannel[]; hasPhone: boolean; hasEmail: boolean; lastSeenAt: string }
export interface AlertSettings { enabled: boolean; channels: AlertChannel[]; availableChannels: AlertChannel[]; recipients: AlertRecipient[] }
export const useLeadsUnread = () => useQuery({ queryKey: ["leads", "unread"], queryFn: () => rawApi<{ count: number }>("GET", `${B}/unread`), refetchInterval: 30_000, retry: false });
export function useMarkLeadsSeen() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => rawApi<{ count: number }>("POST", `${B}/seen`, {}), onSuccess: (d) => qc.setQueryData(["leads", "unread"], d) });
}
export const useLeadAlertSettings = () => useQuery({ queryKey: ["leads", "alerts"], queryFn: () => rawApi<AlertSettings>("GET", `${B}/alerts`) });
export function useLeadAlertChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { config?: { enabled?: boolean; channels?: AlertChannel[] }; sub?: string; recipient?: { leadAlerts?: boolean; channels?: AlertChannel[] } }) => v.sub ? rawApi("PATCH", `${B}/alerts/recipients/${encodeURIComponent(v.sub)}`, v.recipient ?? {}) : rawApi("PATCH", `${B}/alerts`, v.config ?? {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["leads", "alerts"] }),
  });
}
