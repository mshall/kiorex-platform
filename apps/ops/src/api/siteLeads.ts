/** Join requests from the Kiorly site (admin API /admin/leads). Used by both consoles: the Kiorex super admin and the Kiorly admin edition. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi, rawText } from "./client";

export const SITE_LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "ONBOARDING", "WON", "LOST"] as const;
export type SiteLeadStatus = (typeof SITE_LEAD_STATUSES)[number];
export interface PickItem { key: string; en: string; ar: string; active: boolean }
export interface MarketItem extends PickItem { dialCode: string; governorates: PickItem[] }
export interface LeadConfig {
  providerTypes: PickItem[]; specialties: PickItem[]; markets: MarketItem[]; modules: PickItem[]; goLive: PickItem[]; software: PickItem[]; contactChannels: PickItem[]; contactTimes: PickItem[]; lostReasons: PickItem[];
  statusLabels: Record<SiteLeadStatus, { en: string; ar: string }>; requiredFields: string[];
  testMarkers: { emailDomains: string[]; namePrefixes: string[] }; notifications: { applicantAck: boolean; teamAlert: boolean };
}
export interface LeadSettings { version: number; updatedAt: string | null; updatedBy: string | null; isDefault: boolean; config: LeadConfig; requirable: string[] }
export interface LeadSummaryRow {
  id: string; ref: string; status: SiteLeadStatus; mode: "STANDALONE" | "CONNECTED"; providerType: string; legalName: string; tradeName: string | null; contactName: string | null; phoneMasked: string | null; hasEmail: boolean;
  market: string; governorate: string | null; city: string | null; modules: string[]; locale: string; ownerSub: string | null; ownerName: string | null; tags: string[]; isTest: boolean; duplicateOfId: string | null; createdAt: string; updatedAt: string;
  assignedVia: "ROUND_ROBIN" | "HUMAN" | null; routingFlag: "NO_ELIGIBLE_OWNER" | null; lastTouchedAt: string | null; remindedAt: string | null; escalatedAt: string | null; sla: LeadSla;
}
export type SlaState = "OK" | "REMIND" | "ESCALATED" | "OFF";
export interface LeadSla { state: SlaState; since: string; workingMinutes: number; remindAt: string | null; escalateAt: string | null }
export interface LeadList { total: number; page: number; pageSize: number; items: LeadSummaryRow[] }
export interface LeadEventRow { id: string; kind: string; actor: string; actorName: string | null; data: Record<string, unknown>; createdAt: string }
export interface LeadDetail extends LeadSummaryRow {
  phone: string | null; email: string | null; contactRole: string | null; country: string; branches: number | null; staffCount: number | null; specialties: string[]; services: string | null; currentSoftware: string | null;
  licences: Record<string, string>; goLive: string | null; contactChannel: string | null; contactTime: string | null; note: string | null; answers: Record<string, unknown>; consentTextVersion: string; consentAt: string;
  sourceEnv: string | null; lostReason: string | null; duplicates: Array<{ id: string; ref: string; status: string; legalName: string; createdAt: string }>; events: LeadEventRow[]; allowedTransitions: SiteLeadStatus[];
  onboardingRequest: { id: string; status: string; kind: string | null; assigneeSub: string | null; assigneeName: string | null } | null; onboardingDraftOn: string[];
}
export interface LeadFilters { sla?: string; status?: string; type?: string; mode?: string; market?: string; from?: string; to?: string; q?: string; owner?: string; test?: string; duplicates?: string; page?: number; pageSize?: number }

const B = "/admin/leads";
export const leadQs = (f: LeadFilters) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "" && v !== null) p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ""; };

export interface LeadSummaryCounts {
  byStatus: Record<SiteLeadStatus, number>; newLastSevenDays: number; unassignedOpen: number; testLeads: number;
  reminders: { enabled: boolean; untouched: number; remind: number; escalated: number; mineDue: number; noEligible: number };
}
export interface RoutingConfig {
  roundRobin: { enabled: boolean; eligibleSubs: string[]; activeWithinDays: number };
  reminders: { enabled: boolean; remindAfterWorkingHours: number; escalateAfterWorkingHours: number };
  workWeek: { days: number[]; startHour: number; endHour: number };
}
export interface RoutingView {
  version: number; updatedAt: string | null; updatedBy: string | null; isDefault: boolean; config: RoutingConfig; workTimeZone: string;
  candidates: Array<{ sub: string; name: string; roles: string[]; active: boolean; listed: boolean; eligibleNow: boolean; lastSeenAt: string }>;
  state: { lastSub: string | null; assignedCount: number; updatedAt: string | null };
}
export const useLeadRouting = () => useQuery({ queryKey: ["siteLeads", "routing"], queryFn: () => rawApi<RoutingView>("GET", `${B}/routing`), staleTime: 30_000 });
export function useSaveLeadRouting() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { version: number; config: RoutingConfig }) => rawApi<RoutingView>("PUT", `${B}/routing`, v), onSuccess: (d) => { qc.setQueryData(["siteLeads", "routing"], d); void qc.invalidateQueries({ queryKey: ["siteLeads", "summary"] }); } });
}

export const useSiteLeads = (f: LeadFilters) => useQuery({ queryKey: ["siteLeads", "list", f], queryFn: () => rawApi<LeadList>("GET", `${B}${leadQs(f)}`), placeholderData: (p) => p });
export const useSiteLeadSummary = () => useQuery({ queryKey: ["siteLeads", "summary"], queryFn: () => rawApi<LeadSummaryCounts>("GET", `${B}/summary`), refetchInterval: 30_000, retry: false });
export const useSiteLead = (id: string) => useQuery({ queryKey: ["siteLeads", "one", id], queryFn: () => rawApi<LeadDetail>("GET", `${B}/${encodeURIComponent(id)}`) });
export const useSiteLeadOwners = () => useQuery({ queryKey: ["siteLeads", "owners"], queryFn: () => rawApi<Array<{ sub: string; name: string; roles: string[] }>>("GET", `${B}/owners`) });
export const useSiteLeadSettings = () => useQuery({ queryKey: ["siteLeads", "settings"], queryFn: () => rawApi<LeadSettings>("GET", `${B}/settings`), staleTime: 60_000 });

export function useSiteLeadUpdate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { status?: string; lostReason?: string | null; ownerSub?: string | null; isTest?: boolean; addTags?: string[]; removeTags?: string[]; note?: string }) =>
      v.note !== undefined ? rawApi<LeadDetail>("POST", `${B}/${encodeURIComponent(id)}/notes`, { text: v.note }) : rawApi<LeadDetail>("PATCH", `${B}/${encodeURIComponent(id)}`, v),
    onSuccess: (d) => { qc.setQueryData(["siteLeads", "one", id], d); void qc.invalidateQueries({ queryKey: ["siteLeads", "list"] }); void qc.invalidateQueries({ queryKey: ["siteLeads", "summary"] }); },
  });
}
export function useSaveLeadSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { version: number; config: LeadConfig }) => rawApi<LeadSettings>("PUT", `${B}/settings`, v), onSuccess: (d) => { qc.setQueryData(["siteLeads", "settings"], d); } });
}
export const useRemoveTestLeads = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (confirm: boolean) => rawApi<{ dryRun: boolean; count: number }>("POST", `${B}/test/remove`, { confirm }), onSuccess: (d) => { if (!d.dryRun) void qc.invalidateQueries({ queryKey: ["siteLeads"] }); } });
};

/** Downloads the filtered requests as CSV (token in a header, never in a URL). */
export async function downloadLeadsCsv(f: LeadFilters): Promise<void> {
  const { page: _p, pageSize: _s, ...rest } = f;
  const text = await rawText(`${B}/export.csv${leadQs(rest)}`);
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `kiorly-join-requests-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** Localised label of a picklist key (falls back to the key). */
export const labelOf = (list: PickItem[] | undefined, key: string | null | undefined, lang: string): string => { if (!key) return ""; const i = list?.find((x) => x.key === key); return i ? (lang.startsWith("ar") ? i.ar : i.en) : key; };
export const statusLabel = (c: LeadConfig | undefined, s: string, lang: string): string => { const l = c?.statusLabels?.[s as SiteLeadStatus]; return l ? (lang.startsWith("ar") ? l.ar : l.en) : s; };
