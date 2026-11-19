import type { components } from "./schema";
import type { FinanceView, LiquidityView, ModerationRow, OutboxView, ProviderRow, TimelineEntry } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");

export const mapProviders = (r: components["schemas"]["OpsProviderListDto"]): { items: ProviderRow[]; total: number } => ({
  total: r.total,
  items: r.items.map((p) => ({ id: p.id, nameEn: p.nameEn ?? "", nameAr: p.nameAr ?? p.nameEn ?? "", clinicName: p.clinicId, specialty: p.specialty ?? null, status: p.status, listingStatus: p.status, area: null, updatedAt: iso(p.syncedAt) })),
});

export function mapTimeline(r: Any): { bookingId: string; status: string; entries: TimelineEntry[] } {
  const entries: TimelineEntry[] = [
    ...((r.events ?? []) as Any[]).map((e) => ({ at: iso(e.createdAt), kind: String(e.kind), summary: e.kind === "STATE" ? `${e.fromStatus ?? "—"} → ${e.toStatus}` : `${e.kind}${e.detail ? ` ${JSON.stringify(e.detail).slice(0, 120)}` : ""}`, status: e.toStatus ?? null })),
    ...((r.webhooks ?? []) as Any[]).map((w) => ({ at: iso(w.at), kind: "WEBHOOK", summary: `${w.type} (${w.status})`, status: null })),
    ...((r.payments ?? []) as Any[]).map((p) => ({ at: iso(p.createdAt), kind: "PAYMENT", summary: `${p.status} ${Math.round((p.amountMinor ?? 0) / 100)} ${p.currency ?? "EGP"}`, status: null })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return { bookingId: r.booking?.id ?? "", status: r.booking?.status ?? "", entries };
}

export const mapOutbox = (r: components["schemas"]["OutboxListDto"]): OutboxView => ({
  lagSeconds: Math.round(r.stats.lagMs / 1000), pending: r.stats.pending, deadLetters: r.stats.dead,
  items: r.items.map((o) => ({ id: o.id, type: o.type, aggregateId: o.aggregateId, status: o.status, attempts: o.attempts, lastError: o.lastError, createdAt: iso(o.createdAt) })),
});

export function mapFinance(r: Any): FinanceView {
  const cnt = (rows: Any[] | undefined, st: string) => (rows ?? []).filter((x) => x.status === st).reduce((n, x) => n + (x._count ?? 0), 0);
  const runs = (r.reconciliationRuns ?? []) as Any[];
  const disc = runs.filter((x) => x.status === "DISCREPANCIES").length;
  return {
    refunds: { pending: cnt(r.refunds, "PENDING") + cnt(r.refunds, "REQUESTED"), settled: cnt(r.refunds, "SUCCEEDED") + cnt(r.refunds, "SETTLED") },
    payouts: { pendingEgp: 0, sent: ((r.payouts ?? []) as Any[]).length },
    reconciliation: { discrepancies: disc, lastRunAt: runs[0] ? iso(runs[0].createdAt) : null },
    items: [
      ...((r.payouts ?? []) as Any[]).map((p) => ({ id: p.id, kind: "PAYOUT", amountEgp: Math.round((p.amountMinor ?? 0) / 100), status: p.status, at: iso(p.paidAt ?? p.createdAt) })),
      ...runs.map((x) => ({ id: x.id, kind: x.kind === "PSP_DAILY" ? "RECON" : "RECON", amountEgp: 0, status: x.status, at: iso(x.createdAt) })),
    ],
  };
}

export const mapModeration = (rows: components["schemas"]["ModerationCaseDto"][]): ModerationRow[] => rows.map((m) => ({ id: m.id, kind: "REVIEW", excerpt: m.reason, flags: m.reason.split(",").filter(Boolean), slaDueAt: new Date(new Date(m.createdAt).getTime() + 48 * 3_600_000).toISOString(), status: m.status }));

export const mapLiquidity = (r: Any): LiquidityView => ({
  windowDays: r.windowDays ?? 30, listedDoctors: r.listedDoctors ?? 0, liveDoctors: r.liveDoctors ?? 0, searches: r.searches ?? 0, confirmedBookings: r.confirmedBookings ?? 0,
  searchToBookPct: r.searchToBook == null ? null : Math.round(r.searchToBook * 1000) / 10, attended: r.attended ?? 0, noShow: r.noShow ?? 0, noShowPct: r.noShowRate == null ? null : Math.round(r.noShowRate * 1000) / 10,
  slotsPerDay: typeof r.slotsPerDay === "string" ? null : (r.slotsPerDay ?? null), bookingsByStatus: r.bookingsByStatus ?? [],
});
