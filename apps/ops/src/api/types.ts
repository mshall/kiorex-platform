// Response view-models. The real OpenAPI declares request bodies only, so response shapes are typed by hand
// from apps/api/src (control-plane/flags.service.ts, ops/ops.controller.ts, booking, trust, pay).
export interface FlagRow {
  key: string; product: string; class: string; scopes: string[]; dependsOn: string[]; moneyPath: boolean; launchLocked: boolean; whenOff: string | null; gateHint: string | null;
  effective: { global: boolean; market: Record<string, boolean> };
  state: "ON" | "OFF" | "ON_AWAITING_GATE"; reason: string;
  source: { scope: string; scopeId?: string | null; reason?: string | null; ticket?: string | null; setBy?: string | null; expiresAt?: string | null; at?: string | null };
  overrides: { scope: string; scopeId: string | null; reason: string | null; ticket: string | null; expiresAt: string | null; startsAt: string | null }[];
  gate: { gateId: string; approver: string; approvedOn: string; documentUrl: string } | null;
  lastChange: { at: string; actor: string; event: string; newValue: string | null; reason: string | null } | null;
}
export interface FlagAudit { id?: string; createdAt: string; flagKey: string; scope: string | null; scopeId: string | null; oldValue: string | null; newValue: string | null; actor: string; reason: string | null; ticket: string | null; expiresAt?: string | null; emergency?: boolean; event: string | null }
export interface Propagation {
  currentVersion: number;
  products: { product: string; snapshotVersion: number; lastFetchedAt: string | null; ageSeconds: number | null; versionsBehind: number; status: string; lastPush: { version: number; at: string | null; error: string | null }; webhookConfigured: boolean }[];
}
export interface FlagRequest {
  id: string; flagKey: string; scope: string; scopeId: string; value: string; reason: string; ticket: string; expiresAt: string | null;
  requestedBy: string; status: "PENDING" | "APPROVED" | "REJECTED"; approvedBy: string | null; emergency: boolean; reviewDueAt: string | null;
  reviewedBy: string | null; reviewedAt: string | null; createdAt: string; decidedAt: string | null;
}
export interface SetFlagResult { status: "APPLIED" | "PENDING_APPROVAL"; requestId?: string; version?: number }
export interface SetFlagBody { scope: "GLOBAL" | "MARKET" | "ORG"; scopeId?: string; value: "ON" | "OFF"; reason: string; ticket: string; expiresAt?: string; startsAt?: string; emergency?: boolean }
export interface GateBody { gateId: string; approver: string; approvedOn: string; documentUrl: string }

export interface ProviderRow { id: string; nameEn: string; nameAr: string; clinicName: string; specialty: string | null; status: string; listingStatus: string; area: string | null; updatedAt: string }
export interface TimelineEntry { at: string; kind: string; summary: string; status: string | null }
export interface OutboxView { lagSeconds: number; pending: number; deadLetters: number; items: { id: string; type: string; aggregateId: string; status: string; attempts: number; lastError: string | null; createdAt: string }[] }
export interface FinanceView { refunds: { pending: number; settled: number }; payouts: { pendingEgp: number; sent: number }; reconciliation: { discrepancies: number; lastRunAt: string | null }; items: { id: string; kind: string; amountEgp: number; status: string; at: string }[] }
export interface ModerationRow { id: string; kind: "REVIEW" | "COMPLAINT"; excerpt: string; flags: string[]; slaDueAt: string | null; status: string }
export interface LiquidityView { windowDays: number; listedDoctors: number; liveDoctors: number; searches: number; confirmedBookings: number; searchToBookPct: number | null; attended: number; noShow: number; noShowPct: number | null; slotsPerDay: string | null; bookingsByStatus: { status: string; count: number }[] }
