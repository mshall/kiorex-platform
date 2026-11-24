import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatTile } from "@/components/PageHeader";
import { StatCard } from "@/components/kit";
import { StatusChip } from "@/components/kit";
import { useAuth } from "@/auth/AuthProvider";
import { useBreakdown, useChannels, useOverview, useSpend, useSpendMutations, type Filters, type SpendEntry } from "@/api/growthAnalytics";
import { formatMinor } from "@/lib/format";
import { Cell, FilterBar, defaultFilters } from "./shared";

const SOURCES = ["", "CAMPAIGN", "ORGANIC_SEARCH", "REFERRAL", "WHATSAPP", "DIRECT", "PROVIDER_LINK", "WIDGET"];
const tone = (s: SpendEntry["status"]) => (s === "APPROVED" ? "success" : s === "REJECTED" ? "danger" : "warning");

/** Spend entry: maker-checker. The author cannot approve; only APPROVED lines count in CAC, ROAS and MER. Amounts are typed in EGP and stored in piastres. */
function SpendPanel() {
  const { t, i18n } = useTranslation(); const lang = i18n.language;
  const { user } = useAuth(); const list = useSpend(); const m = useSpendMutations();
  const [form, setForm] = useState({ day: new Date().toISOString().slice(0, 10), amount: "", campaign: "", channel: "", sourceKind: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    const egp = Number(form.amount);
    if (!Number.isFinite(egp) || egp <= 0) { setErr(t("ga.spend.badAmount")); return; }
    m.create.mutate({ day: form.day, amountMinor: Math.round(egp * 100), campaign: form.campaign || undefined, channel: form.channel || undefined, sourceKind: form.sourceKind || undefined, note: form.note || undefined }, { onSuccess: () => setForm({ ...form, amount: "", note: "" }), onError: (x) => setErr((x as Error).message) });
  };
  return (
    <section aria-labelledby="ga-h-spend" className="mb-8">
      <h2 id="ga-h-spend" className="mb-1 text-base font-semibold">{t("ga.spend.title")}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{t("ga.spend.hint")}</p>
      <form onSubmit={submit} className="mb-4 flex flex-wrap items-end gap-3" aria-label={t("ga.spend.title")} data-testid="spend-form">
        <div className="space-y-1"><Label htmlFor="sp-day">{t("ga.spend.day")}</Label><Input id="sp-day" type="date" required value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} className="w-40" /></div>
        <div className="space-y-1"><Label htmlFor="sp-amount">{t("ga.spend.amount")}</Label><Input id="sp-amount" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="w-32" /></div>
        <div className="space-y-1"><Label htmlFor="sp-campaign">{t("ga.filter.campaign")}</Label><Input id="sp-campaign" maxLength={64} value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} className="w-40" /></div>
        <div className="space-y-1"><Label htmlFor="sp-channel">{t("ga.filter.channel")}</Label><Input id="sp-channel" maxLength={64} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="w-32" /></div>
        <div className="space-y-1"><Label htmlFor="sp-source">{t("ga.col.source")}</Label>
          <select id="sp-source" className="h-11 rounded-lg border bg-card px-3 text-sm" value={form.sourceKind} onChange={(e) => setForm({ ...form, sourceKind: e.target.value })}>{SOURCES.map((s) => <option key={s} value={s}>{s ? t(`ga.source.${s}`, { defaultValue: s }) : t("ga.unallocated")}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="sp-note">{t("ga.spend.note")}</Label><Input id="sp-note" maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="w-56" /></div>
        <Button type="submit" disabled={m.create.isPending} data-testid="spend-submit">{t("ga.spend.add")}</Button>
      </form>
      {err && <p role="alert" className="mb-3 text-sm text-destructive" data-testid="spend-error">{err}</p>}
      {list.isLoading ? <CardSkeleton rows={1} /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : (
        <DataTable caption={t("ga.spend.title")} rows={list.data!} rowKey={(r) => r.id} empty={t("ga.empty")} columns={[
          { key: "d", header: t("ga.spend.day"), cell: (r) => r.day },
          { key: "a", header: t("ga.spend.amount"), cell: (r) => formatMinor(r.amountMinor, lang, r.currency) },
          { key: "c", header: t("ga.filter.campaign"), cell: (r) => r.campaign || "—" },
          { key: "s", header: t("ga.col.source"), cell: (r) => (r.sourceKind ? t(`ga.source.${r.sourceKind}`, { defaultValue: r.sourceKind }) : t("ga.unallocated")) },
          { key: "st", header: t("ga.spend.status"), cell: (r) => <StatusChip tone={tone(r.status)}>{t(`ga.spend.s.${r.status}`)}</StatusChip> },
          { key: "x", header: t("ga.spend.action"), cell: (r) => r.status !== "PENDING" ? "" : r.createdBy === user?.sub ? <span className="text-xs text-muted-foreground">{t("ga.spend.needsOther")}</span> : (
            <span className="flex gap-2"><Button size="sm" onClick={() => m.decide.mutate({ id: r.id, decision: "approve" })} data-testid={`approve-${r.id}`}>{t("ga.spend.approve")}</Button><Button size="sm" variant="outline" onClick={() => m.decide.mutate({ id: r.id, decision: "reject" })}>{t("ga.spend.reject")}</Button></span>) },
        ]} />
      )}
    </section>
  );
}

/** Acquisition (GRW-P1-J): where bookings come from. Origin mix and provider-led share, source table, top providers, and the spend inputs behind CAC. */
export default function AcquisitionPage() {
  const { t, i18n } = useTranslation(); const lang = i18n.language;
  const [f, setF] = useState<Filters>(defaultFilters);
  const o = useOverview(f); const ch = useChannels(f, "sourceKind"); const pr = useBreakdown("provider", f);
  return (
    <div data-testid="acquisition">
      <PageHeader title={t("acq.title")} hint={t("acq.hint")} />
      <FilterBar value={f} onChange={setF} only={["city", "specialty", "provider", "campaign", "channel"]} />
      <section aria-labelledby="acq-h-mix" className="mb-8">
        <h2 id="acq-h-mix" className="mb-3 text-base font-semibold">{t("acq.mix")}</h2>
        {o.isLoading ? <CardSkeleton rows={1} /> : o.error ? <ErrorState error={o.error} onRetry={() => void o.refetch()} /> : o.data && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="acq-tiles">
            <StatTile label={t("ga.t.providerLed")} value={<Cell v={o.data.providerLedShare} lang={lang} pct />} tone="ok" />
            <StatCard label={t("acq.providerLed")} value={<Cell v={o.data.originMix.providerLed} lang={lang} />} hint={t("acq.providerLedHint")} />
            <StatCard label={t("acq.marketplace")} value={<Cell v={o.data.originMix.marketplace} lang={lang} />} hint={t("acq.marketplaceHint")} />
            <StatCard label={t("acq.unattributed")} value={<Cell v={o.data.originMix.unattributed} lang={lang} />} hint={t("acq.unattributedHint")} />
          </div>
        )}
      </section>
      <section aria-labelledby="acq-h-src" className="mb-8">
        <h2 id="acq-h-src" className="mb-3 text-base font-semibold">{t("ga.channels")}</h2>
        {ch.isLoading ? <CardSkeleton rows={1} /> : ch.error ? <ErrorState error={ch.error} onRetry={() => void ch.refetch()} /> : (
          <DataTable caption={t("ga.channels")} rows={ch.data!.rows} rowKey={(r) => String(r.sourceKind)} empty={t("ga.empty")} columns={[
            { key: "k", header: t("ga.col.source"), cell: (r) => <span className="font-medium">{t(`ga.source.${r.sourceKind}`, { defaultValue: r.sourceKind || t("ga.unallocated") })}</span> },
            { key: "b", header: t("ga.col.bookings"), cell: (r) => <Cell v={r.bookings} lang={lang} /> },
            { key: "a", header: t("ga.col.anp"), cell: (r) => <Cell v={r.attendedNewPatients} lang={lang} /> },
          ]} />
        )}
      </section>
      <section aria-labelledby="acq-h-prov" className="mb-8">
        <h2 id="acq-h-prov" className="mb-3 text-base font-semibold">{t("acq.providers")}</h2>
        {pr.isLoading ? <CardSkeleton rows={1} /> : pr.error ? <ErrorState error={pr.error} onRetry={() => void pr.refetch()} /> : (
          <DataTable caption={t("acq.providers")} rows={pr.data!.rows} rowKey={(r) => String(r.provider)} empty={t("ga.empty")} columns={[
            { key: "p", header: t("ga.filter.provider"), cell: (r) => <span className="font-medium">{String(r.provider)}</span> },
            { key: "b", header: t("ga.col.bookings"), cell: (r) => <Cell v={r.bookings} lang={lang} /> },
            { key: "a", header: t("ga.col.anp"), cell: (r) => <Cell v={r.attendedNewPatients} lang={lang} /> },
            { key: "l", header: t("ga.t.providerLed"), cell: (r) => <Cell v={r.providerLedSharePct} lang={lang} pct /> },
          ]} />
        )}
      </section>
      <SpendPanel />
    </div>
  );
}
