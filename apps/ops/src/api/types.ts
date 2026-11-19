// Console view-models. Wire types come from the GENERATED contract (./schema.d.ts); only the objects the contract leaves
// free-form (`effective`, `source`, `overrides`, `gate`, `lastChange`, dashboards) are narrowed here.
import type { components } from "./schema";

type S = components["schemas"];
export type FlagRow = Omit<S["AdminFlagDto"], "effective" | "source" | "overrides" | "gate" | "lastChange"> & {
  effective: { global: boolean; market: Record<string, boolean> };
  source: { scope: string; scopeId?: string | null; reason?: string | null; ticket?: string | null; setBy?: string | null; expiresAt?: string | null; at?: string | null } | null;
  overrides: { scope: string; scopeId: string | null; reason: string | null; ticket: string | null; expiresAt: string | null; startsAt: string | null }[];
  gate: { gateId: string; approver: string; approvedOn: string; documentUrl: string } | null;
  lastChange: { at: string; actor: string; event: string; newValue: string | null; reason: string | null } | null;
};
// The API returns a few columns the schema omits (reported to the API owner): kept optional so the UI never depends on them.
export type FlagAudit = S["FlagAuditDto"] & { expiresAt?: string | null };
export type FlagRequest = S["FlagChangeRequestDto"] & { expiresAt?: string | null; approvedBy?: string | null; reviewedBy?: string | null; reviewedAt?: string | null; decidedAt?: string | null };
export type Propagation = S["PropagationDto"];
export type PropagationProduct = S["PropagationProductDto"];
export type SetFlagResult = S["SetFlagResultDto"];
export type SetFlagBody = S["SetFlagBody"];
export type GateBody = S["GateBody"];

export type MessageLogItem = S["MessageLogItemDto"];
export type MessagingStats = S["MessagingStatsDto"];
export type FeeStatement = S["FeeStatementDto"];
export type OpsOrder<T> = T & { sub: string; platformFeeMinor: number; takeRateBps: number };
export type PharmacyOrder = OpsOrder<S["PharmacyOrderDto"]>;
export type LabBooking = OpsOrder<S["LabBookingDto"]>;

// Presentation models for the dashboards whose contract schemas are free-form
export interface ProviderRow { id: string; nameEn: string; nameAr: string; clinicName: string; specialty: string | null; status: string; listingStatus: string; area: string | null; updatedAt: string }
export interface TimelineEntry { at: string; kind: string; summary: string; status: string | null }
export interface OutboxView { lagSeconds: number; pending: number; deadLetters: number; items: { id: string; type: string; aggregateId: string; status: string; attempts: number; lastError: string | null; createdAt: string }[] }
export interface FinanceView { refunds: { pending: number; settled: number }; payouts: { pendingEgp: number; sent: number }; reconciliation: { discrepancies: number; lastRunAt: string | null }; items: { id: string; kind: string; amountEgp: number; status: string; at: string }[] }
export interface ModerationRow { id: string; kind: "REVIEW" | "COMPLAINT"; excerpt: string; flags: string[]; slaDueAt: string | null; status: string }
export interface LiquidityView { windowDays: number; listedDoctors: number; liveDoctors: number; searches: number; confirmedBookings: number; searchToBookPct: number | null; attended: number; noShow: number; noShowPct: number | null; slotsPerDay: string | null; bookingsByStatus: { status: string; count: number }[] }
