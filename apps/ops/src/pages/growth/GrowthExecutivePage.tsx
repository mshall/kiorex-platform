import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fmtN, fmtPct } from "@/lib/growthFormat";
import { fmtMasked, useJOverview, useOverview } from "@/api/growth";
import { StatCard, StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { BarList } from "@/components/growth/BarList";
import { DaysSelect, GrowthPage, MarketSelect, Section, useGrowthMarket } from "@/components/growth/GrowthPage";
import { DataTable } from "@/components/DataTable";
import { formatDateTime } from "@/lib/format";

/** Executive overview. Numbers come from GET /ops/growth/overview, which reads the analytics v1 source (package J) when it is registered and the raw growth tables until then. */
export default function GrowthExecutivePage() {
  const { t, i18n } = useTranslation(); const g = useGrowthMarket(); const [days, setDays] = useState(30);
  const q = useOverview(g.market, days); const j = useJOverview(days);
  const o = q.data; const a = j.data; // a = analytics v1 (package J) when it answers
  const count = (name: string) => o?.funnel.find((f) => f.name === name)?.count ?? 0;
  const decisions = o?.origins.reduce((n, x) => n + x.count, 0) ?? 0;
  return (
    <GrowthPage section="overview" toolbar={<><MarketSelect g={g} /><DaysSelect value={days} onChange={setDays} /></>}>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : o && (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="overview-source"><StatusChip tone={a ? "success" : "info"}>{a ? t("growth.overview.source.analytics-v1") : t(`growth.overview.source.${o.source}`)}</StatusChip>{t("growth.overview.since", { at: formatDateTime(o.since, i18n.language) })}{a?.freshness.rolledUpAt && <span data-testid="overview-freshness">{t("growth.overview.freshness", { at: formatDateTime(a.freshness.rolledUpAt, i18n.language) })}</span>}</p>
          {a && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="overview-analytics">
              <StatCard label={t("growth.overview.a.bookings")} value={fmtMasked(a.bookings)} hint={t("growth.overview.a.k", { k: a.k })} />
              <StatCard label={t("growth.overview.a.anp")} value={fmtMasked(a.attendedNewPatients)} hint={t("growth.overview.a.anpHint")} />
              <StatCard label={t("growth.overview.providerLedShare")} value={fmtMasked(a.providerLedShare, "%")} hint={t("growth.overview.providerLedHint")} />
              <StatCard label={t("growth.overview.a.bookingToAttended")} value={fmtMasked(a.bookingToAttended ?? null, "%")} />
            </div>)}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" data-testid="overview-stats">
            {!a && <StatCard label={t("growth.overview.providerLedShare")} value={o.providerLedShare === null ? "—" : fmtPct(o.providerLedShare * 100)} hint={t("growth.overview.providerLedHint")} />}
            {!a && <StatCard label={t("growth.overview.bookingsConfirmed")} value={fmtN(count("BookingConfirmed"))} />}
            {!a && <StatCard label={t("growth.overview.decisions")} value={fmtN(decisions)} />}
            <StatCard label={t("growth.overview.fraudOpen")} value={o.fraudOpen} tone={o.fraudOpen > 0 ? "warn" : "ok"} />
            <StatCard label={t("growth.overview.activeWidgets")} value={o.activeWidgets} />
            <StatCard label={t("growth.overview.indexable")} value={`${o.landingPages.indexable}/${o.landingPages.total}`} />
          </div>
          {a && <p className="text-xs text-muted-foreground" data-testid="overview-raw-note">{t("growth.overview.rawNote")}</p>}
          <div className="grid gap-4 xl:grid-cols-2">
            <Section title={t("growth.overview.funnel")} id="ov-funnel" hint={t("growth.overview.funnelHint")}><BarList testid="funnel" rows={o.funnel.map((f) => ({ id: f.name, label: t(`growth.events.${f.name}`, f.name), value: f.count }))} /></Section>
            <Section title={t("growth.overview.origins")} id="ov-origins" hint={t("growth.overview.originsHint")}>
              {o.origins.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.common.noData")}</p> : <BarList testid="origins" tone="ocean" rows={o.origins.map((x) => ({ id: x.origin, label: t(`growth.origin.${x.origin}`, x.origin), value: x.count }))} />}
            </Section>
            <Section title={t("growth.overview.sources")} id="ov-sources">{o.touchesBySource.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.common.noData")}</p> : <BarList testid="sources" tone="pulse" rows={o.touchesBySource.map((x) => ({ label: t(`growth.sourceKind.${x.sourceKind}`, x.sourceKind), value: x.count }))} />}</Section>
            <Section title={t("growth.overview.reasons")} id="ov-reasons">{o.reasons.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.common.noData")}</p> : <BarList testid="reasons" rows={o.reasons.map((x) => ({ label: x.reason, value: x.count }))} />}</Section>
          </div>
          <Section title={t("growth.overview.configHealth")} id="ov-config" hint={t("growth.overview.configHealthHint")}>
            <DataTable caption={t("growth.overview.configHealth")} rows={o.config} rowKey={(r) => r.kind} columns={[
              { key: "k", header: t("growth.config.colKind"), cell: (r) => <Link className="font-medium text-primary hover:underline" to={`/growth/config?kind=${r.kind}`}><code>{r.kind}</code></Link> },
              { key: "s", header: t("growth.config.colStatus"), cell: (r) => <StatusChip tone={r.source === "ACTIVE" ? "success" : "warning"}>{r.source === "ACTIVE" ? t("growth.config.activeVersion", { version: r.version }) : t("growth.config.proposedDefault")}</StatusChip> },
              { key: "p", header: t("growth.overview.pending"), cell: (r) => <span className="kx-label-num">{r.pending}</span> },
              { key: "sc", header: t("growth.overview.scheduled"), cell: (r) => <span className="kx-label-num">{r.scheduled}</span> },
            ]} />
          </Section>
        </>)}
    </GrowthPage>
  );
}
