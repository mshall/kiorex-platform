// GRW-P4-C ops hooks over /api/v1/admin/growth/corporate. Company data, terms, counts and opaque references only: no endpoint returns a person, a booking or a provider.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

const B = "/admin/growth/corporate";
export type AccountStatus = "LEAD" | "ACTIVE" | "PAUSED" | "ENDED";
export interface Terms { sponsorCeilingMinor: number | null; perMemberCapMinor: number | null; perVisitMaxMinor: number | null; coverBp: number | null; complete: boolean }
export interface Account { id: string; market: string; displayName: string; status: AccountStatus; fundingMode: "SPONSOR_CREDIT" | "PLATFORM_PROMO"; currency: string; contractRef: string | null; legalNameRef: string | null; billingContactRef: string | null; startsAt: string | null; endsAt: string | null; emailDomains: string[]; terms: Terms; termsEditedBy: string | null; activatedBy: string | null; createdAt: string }
export interface CodeRow { id: string; label: string; kind: "OPEN" | "LIST"; maxRedemptions: number; redeemedCount: number; perMemberCapMinor: number | null; expiresAt: string | null; status: "ACTIVE" | "REVOKED" | "EXPIRED" | "EXHAUSTED"; createdAt: string }
export interface CreatedCode { id: string; code: string; label: string; kind: string; maxRedemptions: number; expiresAt: string | null; shownOnce: true }
/** A masked cell is `null` (fewer than k people). */
export interface Report { accountId: string; k: number; currency: string; enrolment: { enrolled: number | null; active: number | null; byVerification: Record<"CODE" | "HR_LIST" | "DOMAIN_EMAIL", number | null> }; utilisation: { membersWhoUsedBenefit: number | null; sponsoredVisits: number | null; sponsoredValueMinor: number | null }; byMonth: Array<{ month: string; membersWhoUsedBenefit: number | null; sponsoredValueMinor: number | null }>; suppressed: string[] }
export interface HrBatch { id: string; status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "PURGED"; rowCount: number; rowsHeld: number; windowEndsAt: string | null; createdAt: string }
export interface InvoiceNote { id: string; month: string; sponsorSpendMinor: number; notes: string; createdAt?: string }
export type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST" | "DUPLICATE";
export interface Lead { id: string; source: "B2B_REFERRAL" | "OUTBOUND" | "INBOUND"; referrerOrgRef: string | null; companyName: string; sizeBucket: string; contactRef: string | null; status: LeadStatus; ownerSub: string | null; notes: string; accountId: string | null; createdAt: string; updatedAt: string }
export const LEAD_NEXT: Record<LeadStatus, LeadStatus[]> = { NEW: ["CONTACTED", "DUPLICATE", "LOST"], CONTACTED: ["QUALIFIED", "LOST"], QUALIFIED: ["PROPOSAL", "LOST"], PROPOSAL: ["WON", "LOST"], LOST: ["CONTACTED"], WON: [], DUPLICATE: [] };

const key = (...k: unknown[]) => ["growth", "corporate", ...k];
export const useAccounts = (status?: string) => useQuery({ queryKey: key("accounts", status ?? ""), queryFn: () => rawApi<{ items: Account[] }>("GET", `${B}/accounts${status ? `?status=${status}` : ""}`) });
export const useAccount = (id: string) => useQuery({ queryKey: key("account", id), enabled: !!id, queryFn: () => rawApi<Account>("GET", `${B}/accounts/${encodeURIComponent(id)}`) });
export const useCodes = (id: string) => useQuery({ queryKey: key("codes", id), enabled: !!id, queryFn: () => rawApi<{ items: CodeRow[] }>("GET", `${B}/accounts/${encodeURIComponent(id)}/codes`) });
export const useReport = (id: string) => useQuery({ queryKey: key("report", id), enabled: !!id, queryFn: () => rawApi<Report>("GET", `${B}/accounts/${encodeURIComponent(id)}/report`) });
export const useHrLists = (id: string) => useQuery({ queryKey: key("hr", id), enabled: !!id, queryFn: () => rawApi<{ items: HrBatch[] }>("GET", `${B}/accounts/${encodeURIComponent(id)}/hr-lists`) });
export const useInvoiceNotes = (id: string) => useQuery({ queryKey: key("notes", id), enabled: !!id, queryFn: () => rawApi<{ items: InvoiceNote[] }>("GET", `${B}/accounts/${encodeURIComponent(id)}/invoice-notes`) });
export const useLeads = (status?: string) => useQuery({ queryKey: key("leads", status ?? ""), queryFn: () => rawApi<{ items: Lead[]; pipeline: Record<string, number> }>("GET", `${B}/leads${status ? `?status=${status}` : ""}`) });

/** One mutation hook per verb; every success refreshes the whole corporate cache (small lists). */
function useMut<V, R>(fn: (v: V) => Promise<R>) { const qc = useQueryClient(); return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: key() }) }); }
export const useCreateAccount = () => useMut((b: { displayName: string; leadId?: string }) => rawApi<Account>("POST", `${B}/accounts`, b));
export const useUpdateTerms = () => useMut((v: { id: string; body: Record<string, unknown> }) => rawApi<Account>("PUT", `${B}/accounts/${encodeURIComponent(v.id)}/terms`, v.body));
export const useAccountAction = () => useMut((v: { id: string; op: "activate" | "pause" | "end" }) => rawApi<Account>("POST", `${B}/accounts/${encodeURIComponent(v.id)}/${v.op}`, {}));
export const useCreateCode = () => useMut((v: { id: string; body: { label: string; kind: "OPEN" | "LIST"; maxRedemptions: number; expiresAt?: string } }) => rawApi<CreatedCode>("POST", `${B}/accounts/${encodeURIComponent(v.id)}/codes`, v.body));
export const useRevokeCode = () => useMut((v: { id: string; codeId: string }) => rawApi<{ id: string }>("POST", `${B}/accounts/${encodeURIComponent(v.id)}/codes/${encodeURIComponent(v.codeId)}/revoke`, {}));
export const useUploadHr = () => useMut((v: { id: string; rows: string[] }) => rawApi<{ batchId: string; rowCount: number; invalidRows: number }>("POST", `${B}/accounts/${encodeURIComponent(v.id)}/hr-lists`, { rows: v.rows }));
export const useDecideHr = () => useMut((v: { batchId: string; decision: "APPROVED" | "REJECTED" }) => rawApi<{ batchId: string; status: string }>("POST", `${B}/hr-lists/${encodeURIComponent(v.batchId)}/decision`, { decision: v.decision }));
export const useAddInvoiceNote = () => useMut((v: { id: string; month: string; notes?: string }) => rawApi<InvoiceNote>("POST", `${B}/accounts/${encodeURIComponent(v.id)}/invoice-notes`, { month: v.month, notes: v.notes }));
export const useCreateLead = () => useMut((b: { companyName: string; source: "OUTBOUND" | "INBOUND"; sizeBucket?: string; contactRef?: string; notes?: string }) => rawApi<Lead>("POST", `${B}/leads`, b));
export const useLeadTransition = () => useMut((v: { id: string; status: LeadStatus; note?: string }) => rawApi<Lead>("POST", `${B}/leads/${encodeURIComponent(v.id)}/transition`, { status: v.status, note: v.note }));
