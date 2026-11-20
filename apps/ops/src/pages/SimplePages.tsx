import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBookingTimeline, useFinance, useLiquidity, useModerate, useModeration, useOutbox, useProviders, useReplay } from "@/api/hooks";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatTile } from "@/components/PageHeader";
import { formatDateTime, formatEgp } from "@/lib/format";
import { useAuth } from "@/auth/AuthProvider";
import { isSuperAdmin } from "@/auth/RequireOps";

const tone = (s: string) => (["LIVE", "SENT", "MATCHED", "DELIVERED"].includes(s) ? "success" : ["DEAD", "UNMATCHED", "FAILED"].includes(s) ? "destructive" : ["PAUSED", "PENDING", "OPEN"].includes(s) ? "warning" : "secondary") as "success" | "destructive" | "warning" | "secondary";

export function ProvidersPage() {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState(""); const [status, setStatus] = useState("");
  const r = useProviders(q, status);
  return (
    <div>
      <PageHeader title={t("providers.title")} hint={t("providers.hint")} />
      <div className="mb-4 flex flex-wrap gap-3">
        <div><Label htmlFor="pq" className="sr-only">{t("common.search")}</Label><Input id="pq" placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} className="w-64" /></div>
        <select aria-label={t("providers.status")} value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="">{t("common.all")}</option><option value="LIVE">LIVE</option><option value="PAUSED">PAUSED</option>
        </select>
      </div>
      {r.isLoading ? <CardSkeleton rows={2} /> : r.error ? <ErrorState error={r.error} onRetry={() => void r.refetch()} /> : (
        <DataTable caption={t("providers.title")} rows={r.data!.items} rowKey={(p) => p.id} empty={t("common.empty")} columns={[
          { key: "n", header: t("providers.name"), cell: (p) => <span className="font-medium">{i18n.language.startsWith("ar") ? p.nameAr : p.nameEn}</span> },
          { key: "c", header: t("providers.clinic"), cell: (p) => p.clinicName }, { key: "s", header: t("providers.specialty"), cell: (p) => p.specialty ?? "—" }, { key: "a", header: t("providers.area"), cell: (p) => p.area ?? "—" },
          { key: "l", header: t("providers.listing"), cell: (p) => <Badge variant={tone(p.listingStatus)}>{p.listingStatus}</Badge> }, { key: "u", header: t("providers.updated"), className: "whitespace-nowrap", cell: (p) => formatDateTime(p.updatedAt, i18n.language) },
        ]} />
      )}
    </div>
  );
}

export function BookingTimelinePage() {
  const { t, i18n } = useTranslation();
  const [input, setInput] = useState(""); const [id, setId] = useState("");
  const r = useBookingTimeline(id);
  return (
    <div>
      <PageHeader title={t("bookings.title")} hint={t("bookings.hint")} />
      <form className="mb-4 flex gap-3" onSubmit={(e) => { e.preventDefault(); setId(input.trim()); }} role="search">
        <div><Label htmlFor="bid" className="sr-only">{t("bookings.id")}</Label><Input id="bid" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("bookings.id")} className="w-72" dir="ltr" /></div>
        <Button type="submit">{t("common.search")}</Button>
      </form>
      {!id ? <p className="text-muted-foreground">{t("bookings.prompt")}</p> : r.isLoading ? <CardSkeleton rows={1} /> : r.error ? <ErrorState error={r.error} onRetry={() => void r.refetch()} /> : (
        <ol className="kx-card space-y-3 p-5" data-testid="booking-timeline">
          <li className="font-semibold">{r.data!.bookingId} · <Badge>{r.data!.status}</Badge></li>
          {r.data!.entries.map((e, i) => <li key={i} className="flex gap-3 text-sm"><Badge variant="secondary" className="w-36 justify-center">{e.kind}</Badge><span className="flex-1">{e.summary}</span><time className="text-muted-foreground">{formatDateTime(e.at, i18n.language)}</time></li>)}
        </ol>
      )}
    </div>
  );
}

export function OutboxPage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState("");
  const r = useOutbox(status); const replay = useReplay();
  const { user } = useAuth();
  const canReplay = !!user && isSuperAdmin(user.roles);
  return (
    <div>
      <PageHeader title={t("outbox.title")} hint={t("outbox.hint")} />
      {r.isLoading ? <CardSkeleton rows={1} /> : r.error ? <ErrorState error={r.error} onRetry={() => void r.refetch()} /> : (<>
        <div className="mb-4 grid gap-3 sm:grid-cols-3"><StatTile label={t("outbox.lag")} value={`${r.data!.lagSeconds}s`} /><StatTile label={t("outbox.pending")} value={r.data!.pending} /><StatTile label={t("outbox.dead")} value={r.data!.deadLetters} tone={r.data!.deadLetters ? "warn" : "ok"} /></div>
        <select aria-label={t("outbox.status")} value={status} onChange={(e) => setStatus(e.target.value)} className="mb-3 h-11 rounded-xl border border-input bg-card px-3 text-sm"><option value="">{t("common.all")}</option><option value="DEAD">DEAD</option><option value="PENDING">PENDING</option></select>
        <DataTable caption={t("outbox.title")} rows={r.data!.items} rowKey={(o) => o.id} empty={t("common.empty")} columns={[
          { key: "t", header: t("outbox.type"), cell: (o) => <code className="text-xs">{o.type}</code> }, { key: "a", header: t("outbox.aggregate"), cell: (o) => <code className="text-xs">{o.aggregateId}</code> },
          { key: "s", header: t("outbox.status"), cell: (o) => <Badge variant={tone(o.status)}>{o.status}</Badge> }, { key: "n", header: t("outbox.attempts"), cell: (o) => o.attempts }, { key: "e", header: t("outbox.error"), cell: (o) => o.lastError ?? "—" },
          { key: "c", header: t("outbox.created"), className: "whitespace-nowrap", cell: (o) => formatDateTime(o.createdAt, i18n.language) },
          { key: "r", header: "", cell: (o) => o.status === "DEAD" ? <Button size="sm" variant="outline" disabled={!canReplay || replay.isPending} onClick={() => replay.mutate(o.id, { onSuccess: () => toast.success(t("outbox.replayed")), onError: () => toast.error(t("states.errorTitle")) })} data-testid="replay">{t("outbox.replay")}</Button> : null },
        ]} />
      </>)}
    </div>
  );
}

export function FinancePage() {
  const { t, i18n } = useTranslation();
  const r = useFinance();
  return (
    <div>
      <PageHeader title={t("finance.title")} hint={t("finance.hint")} />
      {r.isLoading ? <CardSkeleton rows={1} /> : r.error ? <ErrorState error={r.error} onRetry={() => void r.refetch()} /> : (<>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label={t("finance.refundsPending")} value={r.data!.refunds.pending} tone={r.data!.refunds.pending ? "warn" : "ok"} /><StatTile label={t("finance.refundsSettled")} value={r.data!.refunds.settled} />
          <StatTile label={t("finance.payoutsSent")} value={r.data!.payouts.sent} /><StatTile label={t("finance.discrepancies")} value={r.data!.reconciliation.discrepancies} tone={r.data!.reconciliation.discrepancies ? "warn" : "ok"} />
        </div>
        <DataTable caption={t("finance.title")} rows={r.data!.items} rowKey={(x) => x.id} empty={t("common.empty")} columns={[
          { key: "k", header: t("finance.kind"), cell: (x) => <Badge variant="secondary">{x.kind}</Badge> }, { key: "a", header: t("finance.amount"), cell: (x) => formatEgp(x.amountEgp, i18n.language) },
          { key: "s", header: t("outbox.status"), cell: (x) => <Badge variant={tone(x.status)}>{x.status}</Badge> }, { key: "t", header: t("finance.at"), className: "whitespace-nowrap", cell: (x) => formatDateTime(x.at, i18n.language) },
        ]} />
      </>)}
    </div>
  );
}

export function ModerationPage() {
  const { t, i18n } = useTranslation();
  const r = useModeration(); const m = useModerate();
  return (
    <div>
      <PageHeader title={t("moderation.title")} hint={t("moderation.hint")} />
      {r.isLoading ? <CardSkeleton rows={1} /> : r.error ? <ErrorState error={r.error} onRetry={() => void r.refetch()} /> : (
        <DataTable caption={t("moderation.title")} rows={r.data!} rowKey={(x) => x.id} empty={t("common.empty")} columns={[
          { key: "k", header: t("finance.kind"), cell: (x) => <Badge variant="secondary">{x.kind}</Badge> }, { key: "x", header: t("moderation.excerpt"), cell: (x) => x.excerpt },
          { key: "f", header: t("moderation.flags"), cell: (x) => x.flags.map((f) => <Badge key={f} variant="warning" className="me-1">{f}</Badge>) }, { key: "s", header: t("moderation.sla"), className: "whitespace-nowrap", cell: (x) => formatDateTime(x.slaDueAt, i18n.language) },
          { key: "d", header: "", cell: (x) => <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => m.mutate({ id: x.id, resolution: "RESTORED" })}>{t("moderation.approve")}</Button><Button size="sm" variant="outline" onClick={() => m.mutate({ id: x.id, resolution: "KEPT_HIDDEN" })}>{t("moderation.hide")}</Button></div> },
        ]} />
      )}
    </div>
  );
}

export function LiquidityPage() {
  const { t } = useTranslation();
  const r = useLiquidity();
  const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
  return (
    <div>
      <PageHeader title={t("liquidity.title")} hint={t("liquidity.hint", { days: r.data?.windowDays ?? 30 })} />
      {r.isLoading ? <CardSkeleton rows={1} /> : r.error ? <ErrorState error={r.error} onRetry={() => void r.refetch()} /> : (<>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="liquidity-tiles">
          <StatTile label={t("liquidity.listed")} value={r.data!.listedDoctors} /><StatTile label={t("liquidity.live")} value={r.data!.liveDoctors} />
          <StatTile label={t("liquidity.conversion")} value={pct(r.data!.searchToBookPct)} /><StatTile label={t("liquidity.noShow")} value={pct(r.data!.noShowPct)} />
          <StatTile label={t("liquidity.searches")} value={r.data!.searches} /><StatTile label={t("liquidity.confirmed")} value={r.data!.confirmedBookings} />
          <StatTile label={t("liquidity.attended")} value={r.data!.attended} /><StatTile label={t("liquidity.slots")} value={r.data!.slotsPerDay ?? t("liquidity.slotsPending")} />
        </div>
        <DataTable caption={t("liquidity.byStatus")} rows={r.data!.bookingsByStatus} rowKey={(c) => c.status} empty={t("common.empty")} columns={[
          { key: "s", header: t("outbox.status"), cell: (c) => <Badge variant="secondary">{c.status}</Badge> }, { key: "n", header: t("liquidity.count"), cell: (c) => c.count },
        ]} />
      </>)}
    </div>
  );
}
