// Growth & Patient Acquisition (GRW-P1-K): typed hooks over /api/v1/ops/growth/*. These endpoints are not in the generated OpenAPI client yet, so they use rawApi like partner leads.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rawApi } from "./client";
import { fmtN, fmtPct } from "@/lib/growthFormat";

const B = "/ops/growth";
const qs = (o: Record<string, string | number | undefined | null>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ""; };

export type Capability = "read" | "readFinance" | "writeConfig" | "approveConfig" | "reviewFraud" | "manage" | "manageCampaigns" | "reviewPromotions" | "manageCorporate";
export interface Access { roles: string[]; capabilities: Record<Capability, boolean> }
export const useGrowthAccess = () => useQuery({ queryKey: ["growth", "access"], queryFn: () => rawApi<Access>("GET", `${B}/access`), staleTime: 60_000 });

// ── config versions ──
export type ConfigStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ACTIVE" | "SUPERSEDED" | "REJECTED" | "ROLLED_BACK";
export interface ConfigVersion {
  id: string; kind: string; scope: "GLOBAL" | "MARKET"; scopeId: string; version: number; status: ConfigStatus; payload: Record<string, unknown>; effectiveFrom: string | null; effectiveTo: string | null;
  createdBy: string; createdAt: string; approvedBy: string | null; approvedAt: string | null; ticket: string | null; reason: string | null; announcement: string | null; checksum: string; supersedesId: string | null;
}
export interface JsonSchemaNode { 'x-editor'?: string; 'x-pageTypes'?: string[]; 'x-placeholders'?: string[]; type?: string | string[]; enum?: unknown[]; const?: unknown; description?: string; minimum?: number; maximum?: number; pattern?: string; maxLength?: number; items?: JsonSchemaNode; properties?: Record<string, JsonSchemaNode>; required?: string[]; additionalProperties?: boolean | JsonSchemaNode; minItems?: number }
export interface ConfigKindInfo { kind: string; note: string; moneyPolicy: boolean; schema: JsonSchemaNode; defaults: Record<string, unknown> | null }
export interface InForce { kind: string; scope: string; scopeId: string; version: number; versionId: string; source: "ACTIVE" | "PROPOSED_DEFAULT"; effectiveFrom: string | null; payload: Record<string, unknown>; scheduled: Array<{ id: string; version: number; scope: string; scopeId: string; effectiveFrom: string | null }> }
export interface DiffEntry { path: string; kind: "added" | "removed" | "changed"; before?: unknown; after?: unknown }
export interface DiffResult { id: string; version: number; against: { id: string; version: number; status: string } | null; againstIsDefault: boolean; changes: DiffEntry[] }
export interface ValidateResult { valid: boolean; errors: string[]; warnings: string[] }
export interface Propagation { kind: string; scope: string; scopeId: string; cacheTtlMs: number; inForceVersion: number | null; converged: boolean | null; stale: number; liveReaders: number; readers: Array<{ instanceId: string; reader: string; version: number; loadedAt: string; lastSeenAt: string; live: boolean; upToDate: boolean | null }>; scheduled: Array<{ id: string; version: number; effectiveFrom: string | null }> }
export interface AuditRow { id: string; actor: string; action: string; resource?: string; resourceId?: string | null; metadata: unknown; createdAt: string }

export const useConfigKinds = () => useQuery({ queryKey: ["growth", "kinds"], queryFn: () => rawApi<ConfigKindInfo[]>("GET", `${B}/config/kinds`), staleTime: 300_000 });
export const useConfigVersions = (f: { kind?: string; scope?: string; scopeId?: string; status?: string }) => useQuery({ queryKey: ["growth", "versions", f], queryFn: () => rawApi<ConfigVersion[]>("GET", `${B}/config${qs(f)}`) });
export const useInForce = (kind: string, market: string) => useQuery({ queryKey: ["growth", "inforce", kind, market], queryFn: () => rawApi<InForce>("GET", `${B}/config/in-force${qs({ kind, market })}`) });
export const useConfigDiff = (id: string | null) => useQuery({ queryKey: ["growth", "diff", id], enabled: !!id, queryFn: () => rawApi<DiffResult>("GET", `${B}/config/${id}/diff`) });
export const useConfigValidate = (id: string | null) => useQuery({ queryKey: ["growth", "validate", id], enabled: !!id, queryFn: () => rawApi<ValidateResult>("GET", `${B}/config/${id}/validate`) });
export const useConfigDetail = (id: string | null) => useQuery({ queryKey: ["growth", "detail", id], enabled: !!id, queryFn: () => rawApi<ConfigVersion & { audit: AuditRow[] }>("GET", `${B}/config/${id}`) });
export const usePropagation = (kind: string, scope: string, scopeId: string) => useQuery({ queryKey: ["growth", "propagation", kind, scope, scopeId], queryFn: () => rawApi<Propagation>("GET", `${B}/config/propagation${qs({ kind, scope, scopeId })}`), refetchInterval: 15_000 });

export interface DraftBody { kind: string; scope: "GLOBAL" | "MARKET"; scopeId?: string; payload: Record<string, unknown>; effectiveFrom?: string; ticket?: string; reason?: string; announcement?: string }
export type ConfigAction = { op: "create"; body: DraftBody } | { op: "update"; id: string; body: Partial<DraftBody> } | { op: "submit" | "approve" | "activate"; id: string } | { op: "reject"; id: string; reason: string } | { op: "rollback"; body: { kind: string; scope: "GLOBAL" | "MARKET"; scopeId?: string; toVersion: number; reason: string; effectiveFrom?: string; announcement?: string; ticket?: string } };
export function useConfigAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: ConfigAction) => {
      switch (a.op) {
        case "create": return rawApi<ConfigVersion>("POST", `${B}/config`, a.body);
        case "update": return rawApi<ConfigVersion>("PATCH", `${B}/config/${a.id}`, a.body);
        case "reject": return rawApi<ConfigVersion>("POST", `${B}/config/${a.id}/reject`, { reason: a.reason });
        case "rollback": return rawApi<ConfigVersion>("POST", `${B}/config/rollback`, a.body);
        default: return rawApi<ConfigVersion>("POST", `${B}/config/${a.id}/${a.op}`, {});
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["growth"] }),
  });
}

// ── read models ──
export interface Overview {
  source: "internal" | "analytics-v1"; days: number; market: string; since: string; funnel: Array<{ name: string; count: number; masked?: boolean }>; origins: Array<{ origin: string; count: number; masked?: boolean }>; reasons: Array<{ reason: string; count: number }>;
  touchesBySource: Array<{ sourceKind: string; count: number }>; providerLedShare: number | null; fraudOpen: number; activeWidgets: number; landingPages: { total: number; indexable: number }; slugs: number;
  config: Array<{ kind: string; source: string; version: number; scope: string; scopeId: string; effectiveFrom: string | null; pending: number; scheduled: number }>;
}
export const useOverview = (market: string, days: number) => useQuery({ queryKey: ["growth", "overview", market, days], queryFn: () => rawApi<Overview>("GET", `${B}/overview${qs({ market, days })}`) });
export interface Channels { days: number; market: string; kinds: Array<{ sourceKind: string; sources: number; active: number; touches: number }>; sources: Array<{ id: string; sourceKind: string; sourceRef: string; label: string | null; ownerOrgRef: string | null; active: boolean; touches: number; lastTouchAt: string | null }> }
export const useChannels = (market: string, days: number) => useQuery({ queryKey: ["growth", "channels", market, days], queryFn: () => rawApi<Channels>("GET", `${B}/channels${qs({ market, days })}`) });
export function useChannelPatch() { const qc = useQueryClient(); return useMutation({ mutationFn: (v: { id: string; active?: boolean; label?: string }) => rawApi("PATCH", `${B}/channels/${v.id}`, { active: v.active, label: v.label }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["growth"] }) }); }
export interface ProviderAcq { days: number; market: string; ownedSources: number; sourcesByKind: Array<{ sourceKind: string; count: number }>; topOrganisations: Array<{ orgRef: string; touches: number }> }
export const useProviderAcquisition = (market: string, days: number) => useQuery({ queryKey: ["growth", "provider-acq", market, days], queryFn: () => rawApi<ProviderAcq>("GET", `${B}/provider-acquisition${qs({ market, days })}`) });

export interface SeoStatus {
  market: string; config: { version: number; source: string; payload: Record<string, unknown> }; thresholds: { minLiveProviders: number; minUniqueBlocks: number; maxSiblingSimilarityPercent: number };
  robots: { environment: string; mode: string; note: string }; sitemap: { indexablePages: number; shards: number; shardSize: number; lastRenderedAt: string | null };
  pages: { total: number; indexable: number; thin: number; byType: Array<{ pageType: string; indexable: boolean; count: number }>; thinReasons: Array<{ reason: string; count: number }> };
  slugs: { current: number; history: number }; live: { reachable: boolean; robots: { status: number; lines: string[] } | null; sitemap: { status: number; shards: number } | null };
}
export const useSeoStatus = (market: string) => useQuery({ queryKey: ["growth", "seo", market], queryFn: () => rawApi<SeoStatus>("GET", `${B}/seo/status${qs({ market })}`) });
export interface SlugRow { id: string; entityType: string; entityId: string; slug: string; updatedAt: string; history: Array<{ slug: string; replacedBy: string | null; supersededAt: string }> }
export const useSlugs = (market: string, q: string, entityType: string) => useQuery({ queryKey: ["growth", "slugs", market, q, entityType], queryFn: () => rawApi<SlugRow[]>("GET", `${B}/seo/slug-history${qs({ market, q, entityType })}`) });
export interface RedirectRow { id: string; entityType: string; entityId: string; from: string; to: string | null; status: number; supersededAt: string }
export const useRedirects = (market: string) => useQuery({ queryKey: ["growth", "redirects", market], queryFn: () => rawApi<RedirectRow[]>("GET", `${B}/seo/redirect-history${qs({ market })}`) });
export interface LandingRow { id: string; pageType: string; locale: string; params: Record<string, unknown>; indexable: boolean; reasons: string[]; lastRenderedAt: string | null }
export const useLandingPages = (market: string, indexable: string, pageType: string) => useQuery({ queryKey: ["growth", "landing", market, indexable, pageType], queryFn: () => rawApi<{ total: number; items: LandingRow[] }>("GET", `${B}/landing-pages${qs({ market, indexable, pageType })}`) });

export interface Widgets { market: string; policy: { version: number; source: string; payload: Record<string, unknown> }; registrations: Array<{ id: string; orgRef: string; orgSlug: string | null; origins: string[]; status: "ACTIVE" | "DISABLED"; syncedAt: string }>; audit: AuditRow[] }
export const useWidgets = (market: string) => useQuery({ queryKey: ["growth", "widgets", market], queryFn: () => rawApi<Widgets>("GET", `${B}/widgets${qs({ market })}`) });
export function useWidgetStatus() { const qc = useQueryClient(); return useMutation({ mutationFn: (v: { orgRef: string; status: "ACTIVE" | "DISABLED" }) => rawApi("PATCH", `${B}/widgets/${encodeURIComponent(v.orgRef)}`, { status: v.status }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["growth"] }) }); }

export interface TemplateRow { kind: string; templateId: string; purpose: "TRANSACTIONAL" | "REMINDER" | "MARKETING"; consentClass: string; quietHoursBypass: boolean; placeholders: string[]; hasEn: boolean; hasAr: boolean; metaApproval: string; en: string; ar: string }
export const useTemplates = () => useQuery({ queryKey: ["growth", "templates"], queryFn: () => rawApi<TemplateRow[]>("GET", `${B}/templates`) });

export interface IntegrationProvider { kind: string; mode: "mock" | "real"; provider: string; apiUrlSet: boolean; senderIdSet: boolean; secretRefs: Array<{ name: string; set: boolean }>; problems: string[]; ready: boolean; selected: boolean | null }
export interface Integrations { market: string; selection: Record<string, boolean>; whatsappPhoneNumberIdRef: string | null; selectionVersion: number | null; selectionSource: string | null; providers: IntegrationProvider[]; planned: Array<{ key: string; phase: number; label: string; direction: string; note: string }>; flags: Array<{ key: string; effective: boolean; reason: string }>; rule: string }
export const useIntegrations = (market: string) => useQuery({ queryKey: ["growth", "integrations", market], queryFn: () => rawApi<Integrations>("GET", `${B}/integrations${qs({ market })}`) });

export interface FraudSignal { id: string; ruleId: string; score: number; subject: string; evidenceRef: string | null; createdAt: string; reviewStatus: "OPEN" | "CONFIRMED" | "DISMISSED"; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null }
export const useFraudSignals = (market: string, status: string) => useQuery({ queryKey: ["growth", "fraud", market, status], queryFn: () => rawApi<{ counts: Record<string, number>; items: FraudSignal[] }>("GET", `${B}/fraud/signals${qs({ market, status })}`) });
export interface FraudThresholds { editable: boolean; note: string; rule: string; rules: Array<{ ruleId: string; score: number | string; threshold: string; source: string; editableVia: string | null }> }
export const useFraudThresholds = (market: string) => useQuery({ queryKey: ["growth", "fraud-thresholds", market], queryFn: () => rawApi<FraudThresholds>("GET", `${B}/fraud/thresholds${qs({ market })}`) });
export function useFraudReview() { const qc = useQueryClient(); return useMutation({ mutationFn: (v: { id: string; status: "CONFIRMED" | "DISMISSED"; note?: string }) => rawApi("POST", `${B}/fraud/signals/${v.id}/review`, { status: v.status, note: v.note }), onSuccess: () => void qc.invalidateQueries({ queryKey: ["growth"] }) }); }

export interface AuditFilter { action?: string; actor?: string; resource?: string; from?: string; to?: string; before?: string }
export const useGrowthAudit = (f: AuditFilter) => useQuery({ queryKey: ["growth", "audit", f], queryFn: () => rawApi<{ items: AuditRow[]; nextBefore: string | null }>("GET", `${B}/audit${qs({ ...f, take: 50 })}`) });

export interface MarketRow { code: string; live: boolean; state: string; name: { ar: string; en: string }; currency: string; phoneCode: string; locales: string[]; timeZone: string; quietHours: { start: string; end: string }; consent: Record<string, unknown>; retention: Record<string, unknown>; marketing: { marketingLicenceConfirmed: boolean; qrEnabled: boolean | null; flags: Array<{ key: string; effective: boolean; reason: string }> }; geography: { geographyListRef: string | null; cities: number; districts: number; note: string }; integrations: Record<string, boolean>; versions: Record<string, { version: number; source: string; scope: string } | null> }
export const useMarkets = () => useQuery({ queryKey: ["growth", "markets"], queryFn: () => rawApi<MarketRow[]>("GET", `${B}/markets`) });

export interface AnalyticsRows { market: string; days: number; source: string; note: string; events: Array<{ day: string; name: string; count: number }>; decisions: Array<{ day: string; origin: string; count: number }> }
export const useGrowthAnalytics = (market: string, days: number) => useQuery({ queryKey: ["growth", "analytics", market, days], queryFn: () => rawApi<AnalyticsRows>("GET", `${B}/analytics${qs({ market, days })}`) });
export interface Finance { market: string; days: number; decisions: { providerLed: number; marketplace: number; unattributed: number; corrections: number }; revenueFacts: { charges: number; reversals: number; currency: string } | null; rule: string }
export const useGrowthFinance = (market: string, days: number, enabled: boolean) => useQuery({ queryKey: ["growth", "finance", market, days], enabled, queryFn: () => rawApi<Finance>("GET", `${B}/finance${qs({ market, days })}`) });
export interface Evidence { bookingId: string; decision: { id: string; origin: string; reason: string; policyVersion: string; inputsHash: string; supersedesId: string | null; createdAt: string }; touches: Array<{ id: string; kind: string; ref?: string; occurredAt: string; dwellMs: number | null; winning: boolean }> }
export const useEvidence = (bookingId: string) => useQuery({ queryKey: ["growth", "evidence", bookingId], enabled: bookingId.length > 3, retry: false, queryFn: () => rawApi<Evidence>("GET", `/growth/v1/evidence/${encodeURIComponent(bookingId)}`) });

// ── Analytics v1 (package J) read through its ops API, loosely typed on purpose: the console shows a figure when J serves it and falls back to the raw tables when it does not. ──
export type Masked = number | "<10";
export interface JFreshness { rolledUpAt: string | null; lastEventAt: string | null }
export interface JOverview {
  period: { from: string; to: string }; k: number; freshness: JFreshness; bookings: Masked; attendedNewPatients: Masked; feeBearingNewPatients?: Masked; providerLedShare: Masked | null;
  originMix: { providerLed: Masked; marketplace: Masked; unattributed: Masked }; bookingToAttended?: Masked | null; searchToBooking?: Masked | null;
  kiorexRevenueMinor?: Masked; commissionPendingMinor?: Masked; spendMinor?: number; blendedCacMinor?: Masked | null; merRatio?: Masked | null; coverage?: { visitorStageAvailable: boolean; note?: string }; masked?: boolean; revenueNote?: string;
}
export interface JFunnelStage { stage: string; count: Masked; kind: string; stepConversionPct: Masked | null; cumulativeConversionPct: Masked | null }
export interface JChannelRow { sourceKind?: string; campaign?: string; bookings: Masked; attendedNewPatients: Masked; spendMinor?: number; cacMinor?: Masked | null; roas?: Masked | null }
const jRange = (days: number) => { const to = new Date(); const from = new Date(to.getTime() - days * 86_400_000); const d = (x: Date) => x.toISOString().slice(0, 10); return { from: d(from), to: d(to) }; };
const J = "/ops/growth-analytics";
export const useJOverview = (days: number) => useQuery({ queryKey: ["growth", "j-overview", days], retry: false, queryFn: () => rawApi<JOverview>("GET", `${J}/overview${qs(jRange(days))}`) });
export const useJFunnel = (days: number) => useQuery({ queryKey: ["growth", "j-funnel", days], retry: false, queryFn: () => rawApi<{ stages: JFunnelStage[]; freshness: JFreshness }>("GET", `${J}/funnel${qs(jRange(days))}`) });
export const useJChannels = (days: number) => useQuery({ queryKey: ["growth", "j-channels", days], retry: false, queryFn: () => rawApi<{ rows: JChannelRow[] }>("GET", `${J}/channels${qs(jRange(days))}`) });
export const fmtMasked = (v: Masked | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : v === "<10" ? "\u2066<10\u2069" : suffix === "%" ? fmtPct(v, 1) : `${fmtN(v)}${suffix}`);
