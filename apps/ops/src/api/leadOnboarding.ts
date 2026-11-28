/** DRAFT onboarding requests created by won join requests (admin API /admin/lead-onboarding). Both consoles use it. Nothing here activates an organisation. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

export const ONBOARDING_REQUEST_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type OnboardingRequestStatus = (typeof ONBOARDING_REQUEST_STATUSES)[number];
export interface LeadOnboardingSummary { id: string; status: OnboardingRequestStatus; kind: string | null; assigneeSub: string | null; assigneeName: string | null }
export interface LeadOnboardingRequest {
  id: string; leadId: string; contactRef: string; status: OnboardingRequestStatus; kind: string | null; legalName: string; providerType: string; mode: "STANDALONE" | "CONNECTED"; modules: string[]; market: string;
  assigneeSub: string | null; assigneeName: string | null; note: string | null; isTest: boolean; createdBy: string; submittedBy: string | null; submittedAt: string | null; decidedBy: string | null; decidedAt: string | null;
  decisionNote: string | null; createdAt: string; updatedAt: string; leadStatus: string | null; blockers: string[]; kinds: string[];
  enrolmentId: string | null; enrolmentIssuedAt: string | null; enrolmentIssuedBy: string | null; enrolment: { id: string; status: string; expiresAt: string; kind: string } | null;
}
/** Present ONLY in the answer of the approval (or of a re-issue): the one-time enrolment code. Keep it in component state, never in the query cache, a URL or storage. */
export type WithEnrolmentCode = LeadOnboardingRequest & { enrolmentCode?: string; shownOnce?: boolean };
export interface LeadOnboardingList { total: number; page: number; pageSize: number; items: LeadOnboardingRequest[] }

const B = "/admin/lead-onboarding";
export const useLeadOnboardingList = (f: { status?: string; assignee?: string; mode?: string; page?: number }) => {
  const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== "") p.set(k, String(v)); const qs = p.toString();
  return useQuery({ queryKey: ["leadOnboarding", "list", f], queryFn: () => rawApi<LeadOnboardingList>("GET", `${B}${qs ? `?${qs}` : ""}`), placeholderData: (x) => x });
};
export const useLeadOnboarding = (id: string) => useQuery({ queryKey: ["leadOnboarding", "one", id], queryFn: () => rawApi<LeadOnboardingRequest>("GET", `${B}/${encodeURIComponent(id)}`) });

type Action = { kind: "patch"; body: { kind?: string | null; assigneeSub?: string | null; note?: string | null } } | { kind: "submit" } | { kind: "approve"; note?: string } | { kind: "reject"; reason: string } | { kind: "cancel"; reason: string } | { kind: "reopen" } | { kind: "enrolment" };
export function useLeadOnboardingAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Action) => a.kind === "patch" ? rawApi<WithEnrolmentCode>("PATCH", `${B}/${encodeURIComponent(id)}`, a.body) : rawApi<WithEnrolmentCode>("POST", `${B}/${encodeURIComponent(id)}/${a.kind}`, a.kind === "approve" ? { note: a.note } : a.kind === "reject" || a.kind === "cancel" ? { reason: a.reason } : {}),
    onSuccess: (d) => {
      const { enrolmentCode: _code, shownOnce: _once, ...safe } = d; // the code never enters the cache
      qc.setQueryData(["leadOnboarding", "one", id], safe); void qc.invalidateQueries({ queryKey: ["leadOnboarding", "list"] }); void qc.invalidateQueries({ queryKey: ["siteLeads", "one", d.leadId] }); },
  });
}
/** Lead detail "Create the draft" (only for a won request without one; idempotent on the server). */
export function useCreateLeadOnboarding(leadId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => rawApi<LeadOnboardingRequest & { created: boolean }>("POST", `${B}/by-lead/${encodeURIComponent(leadId)}`, {}), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["siteLeads", "one", leadId] }); void qc.invalidateQueries({ queryKey: ["leadOnboarding"] }); } });
}
