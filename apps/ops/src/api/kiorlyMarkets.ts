import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";

/** Kiorly admin edition, Market launch (ADR-060). The Clinic owns the market data; these hooks talk to the Kiorex API's audited door to it. No state is kept here beyond the query cache. */
export type MarketStatus = "DRAFT" | "LIVE" | "SUNSET";
export type Operational = "ACTIVE" | "PAUSED" | "DISABLED";
export interface Readiness {
  taxPack: { ok: boolean; invoiceVatPercent?: number; saasVatPercent?: number; defaultVisitFee?: number; trnRequired?: boolean; trnFormat?: string | null };
  crossBorder: { required: boolean; approved: boolean; invalid?: boolean };
  hostCellKnown: boolean; commercialConfigured: boolean; blockers: Array<{ code: string; message: string }>; canLaunch: boolean;
}
export interface KiorexState { known: boolean; live: boolean; state: string; flag: string | null }
export interface KiorlyMarket {
  id: string; code: string; nameEn: string; nameAr: string; status: MarketStatus; operationalStatus: Operational; operability: string; pausedUntil: string | null; launchedAt: string | null;
  dataRegion: string; hostCell: string; defaultCurrency: string; defaultTimezone: string; defaultLocale: string; defaultPhoneRegion: string;
  crossBorderApprovalRef: string | null; crossBorderExpiresAt: string | null; requireSecondApprover: boolean; organizationCount: number | null; readiness: Readiness; kiorex: KiorexState; lastProvisionNote?: string | null;
}
export interface MarketList { items: KiorlyMarket[]; canChange: boolean }
export interface CountryDefaults { code: string; nameEn: string; nameAr: string; defaultCurrency: string; defaultTimezone: string; defaultLocale: string; defaultPhoneRegion: string; weekendDays: number[]; enabledLanguages: string[] }
export interface AuditEvent { id: string; action: string; fromStatus: string | null; toStatus: string | null; fromOperational: string | null; toOperational: string | null; actorId: string; actorEmail: string | null; actorSource: string; reason: string; approvalRef: string | null; approvalLink: string | null; secondApproverId: string | null; createdAt: string }
export interface ChangeRequest { id: string; action: string; reason: string; requestedBy: string; requestedEmail: string | null; status: string; createdAt: string }
export interface MarketDetail { market: KiorlyMarket; legal: { config: { crossBorderTransfer?: Record<string, unknown>; pilotException?: Record<string, unknown> }; crossBorderRequired: boolean; launchApproved: boolean; daysUntilExpiry: number | null }; commercial: { source: string } }
export type Verb = "launch" | "pause" | "disable" | "enable";

const B = "/admin/kiorly-markets";
export const KEY = ["kiorly-markets"] as const;
export const useKiorlyMarkets = () => useQuery({ queryKey: [...KEY, "list"], queryFn: () => rawApi<MarketList>("GET", B), refetchInterval: 60_000 });
export const useCountryDefaults = (enabled: boolean) => useQuery({ queryKey: [...KEY, "defaults"], queryFn: () => rawApi<CountryDefaults[]>("GET", `${B}/country-defaults`), enabled, staleTime: 3_600_000 });
export const useMarketDetail = (id: string | null) => useQuery({ queryKey: [...KEY, "one", id], queryFn: () => rawApi<MarketDetail>("GET", `${B}/${id}`), enabled: !!id });
export const useMarketAudit = (id: string | null, before: string | null) => useQuery({ queryKey: [...KEY, "audit", id, before], queryFn: () => rawApi<{ items: AuditEvent[]; nextBefore: string | null }>("GET", `${B}/${id}/audit?limit=25${before ? `&before=${encodeURIComponent(before)}` : ""}`), enabled: !!id });
export const useMarketRequests = (id: string | null) => useQuery({ queryKey: [...KEY, "requests", id], queryFn: () => rawApi<ChangeRequest[]>("GET", `${B}/${id}/change-requests?status=PENDING`), enabled: !!id });

function useChange<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }) });
}
export const useCreateMarket = () => useChange((b: Record<string, unknown>) => rawApi("POST", B, b));
export const useTransition = () => useChange((v: { id: string; verb: Verb; body: Record<string, unknown> }) => rawApi<{ pending?: boolean; unchanged?: boolean }>("POST", `${B}/${v.id}/${v.verb}`, v.body));
export const useSaveTaxPack = () => useChange((v: { id: string; body: Record<string, unknown> }) => rawApi("PUT", `${B}/${v.id}/tax-pack`, v.body));
export const useSaveLegal = () => useChange((v: { id: string; body: Record<string, unknown> }) => rawApi("PUT", `${B}/${v.id}/legal-config`, v.body));
export const useSecondApprover = () => useChange((v: { id: string; body: Record<string, unknown> }) => rawApi("PATCH", `${B}/${v.id}/second-approver`, v.body));
export const useDecideRequest = () => useChange((v: { id: string; rid: string; verb: "approve" | "reject" }) => rawApi("POST", `${B}/${v.id}/change-requests/${v.rid}/${v.verb}`, {}));
