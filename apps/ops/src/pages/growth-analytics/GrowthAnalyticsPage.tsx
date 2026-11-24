import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatTile } from "@/components/PageHeader";
import { downloadCsv, useChannels, useCohorts, useFunnel, useOverview, type Filters } from "@/api/growthAnalytics";
import { formatDateTime } from "@/lib/format";
import { Cell, FilterBar, defaultFilters } from "./shared";

const label = (v: string | undefined, none: string) => v || none;

/**
 * Growth Analytics (GRW-P1-J): executive overview, funnel, channel table and cohort retention under one filter bar. Definitions are KX-32 section 04.
 * Gross booking value is shown only as a volume indicator and labelled so; Kiorex revenue is commission charges net of reversals. Cells under 10 are masked by the server.
 */
export default function GrowthAnalyticsPage() {
  const { t, i18n } = useTranslation(); const lang = i18n.language;
  const [f, setF] = useState<Filters>(defaultFilters);
  const o = useOverview(f); const fu = useFunnel(f); const ch = useChannels(f, "sourceKind"); const co = useCohorts(f);
  const exp = (r: string) => () => { void downloadCsv(r, f).catch(() => undefined); };
  const maxCount = Math.max(1, ...(fu.data?.stages ?? []).map((s) => (typeof s.count === "number" ? s.count : 0)));
  return (
    <div data-testid="growth-analytics">
      <PageHeader title={t("ga.title")} hint={t("ga.hint")} actions={<Button variant="outline" onClick={exp("overview")} data-testid="export-overview"><Download aria-hidden="true" />{t("ga.export")}</Button>} />
      <FilterBar value={f} onChange={setF} />
      <p className="mb-3 text-xs text-muted-foreground" data-testid="ga-fresh">{t("ga.freshness", { at: o.data?.freshness.rolledUpAt ? formatDateTime(o.data.freshness.rolledUpAt, lang) : t("ga.never") })} · {t("ga.kNote")}</p>

      <section aria-labelledby="ga-h-overview" className="mb-8">
        <h2 id="ga-h-overview" className="mb-3 text-base font-semibold">{t("ga.overview")}</h2>
        {o.isLoading ? <CardSkeleton rows={1} /> : o.error ? <ErrorState error={o.error} onRetry={() => void o.refetch()} /> : o.data && (<>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="ga-tiles">
            <StatTile label={t("ga.t.bookings")} value={<Cell v={o.data.bookings} lang={lang} />} />
            <StatTile label={t("ga.t.anp")} value={<Cell v={o.data.attendedNewPatients} lang={lang} />} />
            <StatTile label={t("ga.t.providerLed")} value={<Cell v={o.data.providerLedShare} lang={lang} pct />} />
            <StatTile label={t("ga.t.attended")} value={<Cell v={o.data.bookingToAttended} lang={lang} pct />} />
            <StatTile label={t("ga.t.gbv")} value={<Cell v={o.data.grossBookingValueMinor} lang={lang} money />} />
            <StatTile label={t("ga.t.revenue")} value={<Cell v={o.data.kiorexRevenueMinor} lang={lang} money />} tone="ok" />
            <StatTile label={t("ga.t.spend")} value={o.data.spendMinor === undefined ? "—" : <Cell v={o.data.spendMinor} lang={lang} money />} />
            <StatTile label={t("ga.t.cac")} value={<Cell v={o.data.blendedCacMinor} lang={lang} money />} />
            <StatTile label={t("ga.t.mer")} value={<Cell v={o.data.merRatio} lang={lang} ratio />} />
            <StatTile label={t("ga.t.ltv")} value={o.data.ltvMinor === undefined ? "—" : <Cell v={o.data.ltvMinor} lang={lang} money />} />
            <StatTile label={t("ga.t.search")} value={<Cell v={o.data.searchToBooking} lang={lang} pct />} />
            <StatTile label={t("ga.t.pending")} value={<Cell v={o.data.commissionPendingMinor} lang={lang} money />} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground" data-testid="ga-gbv-note">{t("ga.gbvNote")}</p>
          {!o.data.coverage.visitorStageAvailable && <p className="mt-1 text-xs text-muted-foreground">{t("ga.coverageNote")}</p>}
        </>)}
      </section>

      <section aria-labelledby="ga-h-funnel" className="mb-8">
        <div className="mb-3 flex items-center justify-between"><h2 id="ga-h-funnel" className="text-base font-semibold">{t("ga.funnel")}</h2><Button variant="ghost" size="sm" onClick={exp("funnel")}><Download aria-hidden="true" />{t("ga.export")}</Button></div>
        {fu.isLoading ? <CardSkeleton rows={1} /> : fu.error ? <ErrorState error={fu.error} onRetry={() => void fu.refetch()} /> : (
          <DataTable caption={t("ga.funnel")} rows={fu.data!.stages} rowKey={(s) => s.stage} empty={t("ga.empty")} columns={[
            { key: "s", header: t("ga.col.stage"), cell: (s) => <span className="font-medium">{t(`ga.stage.${s.stage}`, { defaultValue: s.stage })}</span> },
            { key: "c", header: t("ga.col.count"), cell: (s) => <Cell v={s.count} lang={lang} /> },
            { key: "b", header: t("ga.col.share"), cell: (s) => (typeof s.count === "number" ? <div className="h-2 w-40 rounded bg-muted" aria-hidden="true"><div className="h-2 rounded bg-primary" style={{ width: `${Math.round((s.count / maxCount) * 100)}%` }} /></div> : "") },
            { key: "st", header: t("ga.col.step"), cell: (s) => <Cell v={s.stepConversionPct} lang={lang} pct /> },
            { key: "cu", header: t("ga.col.cumulative"), cell: (s) => <Cell v={s.cumulativeConversionPct} lang={lang} pct /> },
          ]} />
        )}
      </section>

      <section aria-labelledby="ga-h-channels" className="mb-8">
        <div className="mb-3 flex items-center justify-between"><h2 id="ga-h-channels" className="text-base font-semibold">{t("ga.channels")}</h2><Button variant="ghost" size="sm" onClick={exp("channels")}><Download aria-hidden="true" />{t("ga.export")}</Button></div>
        {ch.isLoading ? <CardSkeleton rows={1} /> : ch.error ? <ErrorState error={ch.error} onRetry={() => void ch.refetch()} /> : (
          <DataTable caption={t("ga.channels")} rows={ch.data!.rows} rowKey={(r) => `${r.sourceKind}|${r.campaign ?? ""}`} empty={t("ga.empty")} columns={[
            { key: "k", header: t("ga.col.source"), cell: (r) => <span className="font-medium">{t(`ga.source.${r.sourceKind}`, { defaultValue: label(r.sourceKind, t("ga.unallocated")) })}</span> },
            { key: "b", header: t("ga.col.bookings"), cell: (r) => <Cell v={r.bookings} lang={lang} /> },
            { key: "a", header: t("ga.col.anp"), cell: (r) => <Cell v={r.attendedNewPatients} lang={lang} /> },
            { key: "sp", header: t("ga.col.spend"), cell: (r) => (r.spendMinor === undefined ? "—" : <Cell v={r.spendMinor} lang={lang} money />) },
            { key: "rv", header: t("ga.col.revenue"), cell: (r) => <Cell v={r.revenueMinor} lang={lang} money /> },
            { key: "cac", header: t("ga.col.cac"), cell: (r) => <Cell v={r.cacMinor} lang={lang} money /> },
            { key: "roas", header: t("ga.col.roas"), cell: (r) => <Cell v={r.roas} lang={lang} ratio /> },
            { key: "lc", header: t("ga.col.ltvCac"), cell: (r) => <Cell v={r.ltvToCac} lang={lang} ratio /> },
            { key: "vd", header: t("ga.col.verdict"), cell: (r) => (r.verdict && r.verdict !== "<10" ? t(`ga.verdict.${r.verdict}`) : <Cell v={r.verdict as never} lang={lang} />) },
          ]} />
        )}
      </section>

      <section aria-labelledby="ga-h-cohorts" className="mb-8">
        <div className="mb-3 flex items-center justify-between"><h2 id="ga-h-cohorts" className="text-base font-semibold">{t("ga.cohorts")}</h2><Button variant="ghost" size="sm" onClick={exp("cohorts")}><Download aria-hidden="true" />{t("ga.export")}</Button></div>
        <p className="mb-2 text-xs text-muted-foreground">{t("ga.cohortNote")}</p>
        {co.isLoading ? <CardSkeleton rows={1} /> : co.error ? <ErrorState error={co.error} onRetry={() => void co.refetch()} /> : (
          <DataTable caption={t("ga.cohorts")} rows={co.data!.rows} rowKey={(r) => r.cohort} empty={t("ga.empty")} columns={[
            { key: "c", header: t("ga.col.cohort"), cell: (r) => <span className="font-medium">{r.cohort}</span> },
            { key: "s", header: t("ga.col.size"), cell: (r) => <Cell v={r.size} lang={lang} /> },
            { key: "r30", header: t("ga.col.r30"), cell: (r) => <Cell v={r.retention30Pct} lang={lang} pct /> },
            { key: "r90", header: t("ga.col.r90"), cell: (r) => <Cell v={r.retention90Pct} lang={lang} pct /> },
            { key: "r180", header: t("ga.col.r180"), cell: (r) => <Cell v={r.retention180Pct} lang={lang} pct /> },
          ]} />
        )}
      </section>
    </div>
  );
}
