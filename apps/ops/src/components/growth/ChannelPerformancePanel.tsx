import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { useChannelPerformance, type CampaignPerfRow, type Masked } from "@/api/integrations";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";
import { formatMinor } from "@/lib/format";

/** GRW-P2-F external numbers beside first-party facts. A hidden ratio shows its reason; "not connected" is never zero. */
export function ChannelPerformancePanel({ market, days }: { market: string; days: number }) {
  const { t, i18n } = useTranslation(); const q = useChannelPerformance(market, days); const lang = i18n.language;
  const money = (v: number | "<10" | null) => (v === null ? "—" : v === "<10" ? "<10" : formatMinor(v, lang));
  const cnt = (v: Masked) => (v === "<10" ? "<10" : fmtN(v));
  const why = (h: string | null) => (h ? t(`growth.perf.hidden.${h}`, h) : null);
  return (
    <Section title={t("growth.perf.title")} id="perf" hint={t("growth.perf.hint")}>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (() => { const d = q.data; return (
        <div className="space-y-5" data-testid="channel-performance">
          {d.gaps.length > 0 && <ul className="space-y-1" data-testid="perf-gaps">{d.gaps.map((g) => <li key={g} className="flex items-start gap-2 rounded-xl border border-warning/40 bg-card p-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />{t(`growth.perf.gaps.${g.split(":")[0]}`, { key: g.split(":")[1] ?? "" })}</li>)}</ul>}
          <DataTable caption={t("growth.perf.channels")} rows={d.channels} rowKey={(r) => r.kind} columns={[
            { key: "k", header: t("growth.perf.channel"), cell: (r) => <b>{r.label}</b> },
            { key: "st", header: t("growth.perf.state"), cell: (r) => <div className="flex flex-wrap gap-1"><StatusChip tone={r.connected ? "success" : "neutral"} data-testid={`perf-state-${r.kind}`}>{r.connected ? t("growth.perf.connected") : t("growth.integrations2.notConnected")}</StatusChip>{r.synthetic && <StatusChip tone="info" dot={false}>{t("growth.integrations2.synthetic")}</StatusChip>}</div> },
            { key: "sp", header: t("growth.perf.spend"), cell: (r) => (r.metrics?.spendMinor == null ? "—" : formatMinor(r.metrics.spendMinor, lang)) },
            { key: "im", header: t("growth.perf.impressions"), cell: (r) => (r.metrics?.impressions == null ? "—" : fmtN(r.metrics.impressions)) },
            { key: "cl", header: t("growth.perf.clicks"), cell: (r) => (r.metrics?.clicks == null ? "—" : fmtN(r.metrics.clicks)) },
            { key: "ct", header: t("growth.perf.ctr"), cell: (r) => (r.metrics?.ctrPct == null ? "—" : `${fmtN(r.metrics.ctrPct)}%`) },
            { key: "cpc", header: t("growth.perf.cpc"), cell: (r) => (r.metrics?.cpcMinor == null ? "—" : formatMinor(r.metrics.cpcMinor, lang)) },
          ]} />
          <DataTable caption={t("growth.perf.campaigns")} rows={d.campaigns} rowKey={(r) => r.key} empty={t("growth.perf.noCampaigns")} columns={[
            { key: "k", header: t("growth.perf.campaign"), cell: (r: CampaignPerfRow) => <div><b>{r.name ?? r.key}</b><div className="text-xs text-muted-foreground" dir="ltr">{r.key}</div></div> },
            { key: "ext", header: t("growth.perf.external"), cell: (r) => (r.external ? <div className="text-xs"><div>{formatMinor(r.external.spendMinor, lang)}</div><div>{fmtN(r.external.clicks)} {t("growth.perf.clicks")}</div>{r.synthetic && <StatusChip tone="info" dot={false}>{t("growth.integrations2.synthetic")}</StatusChip>}</div> : <StatusChip tone="neutral">{t("growth.integrations2.notConnected")}</StatusChip>) },
            { key: "ap", header: t("growth.perf.approved"), cell: (r) => formatMinor(r.spend.approvedMinor, lang) },
            { key: "rec", header: t("growth.perf.reconciliation"), cell: (r) => <div className="text-xs"><StatusChip tone={r.spend.conflict ? "warning" : "neutral"} dot={false} data-testid={`perf-rec-${r.key}`}>{t(`growth.perf.rec.${r.spend.note}`, r.spend.note)}</StatusChip>{r.spend.deltaBp !== null && <div dir="ltr">{r.spend.deltaBp > 0 ? "+" : ""}{(r.spend.deltaBp / 100).toFixed(1)}%</div>}</div> },
            { key: "anp", header: t("growth.perf.anp"), cell: (r) => cnt(r.firstParty.attendedNewPatients) },
            { key: "cac", header: t("growth.perf.cac"), cell: (r) => <div><span data-testid={`perf-cac-${r.key}`}>{money(r.cacMinor)}</span>{r.cacHidden && <div className="text-xs text-muted-foreground">{why(r.cacHidden)}</div>}</div> },
            { key: "roas", header: t("growth.perf.roas"), cell: (r) => <div><span>{r.roas === null ? "—" : r.roas === "<10" ? "<10" : fmtN(r.roas)}</span>{r.roasHidden && <div className="text-xs text-muted-foreground">{why(r.roasHidden)}</div>}</div> },
          ]} />
          <div className="grid gap-4 md:grid-cols-2">
            <div><h3 className="text-sm font-semibold">{t("growth.perf.blended")}</h3>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="perf-blended">
                <dt>{t("growth.perf.spendTotal")}</dt><dd>{formatMinor(d.blended.spendMinor, lang)}</dd>
                <dt>{t("growth.perf.rewardCost")}</dt><dd>{formatMinor(d.blended.rewardCostMinor, lang)}</dd>
                <dt>{t("growth.perf.anp")}</dt><dd>{cnt(d.blended.attendedNewPatients)}</dd>
                <dt>{t("growth.perf.cacWithout")}</dt><dd>{money(d.blended.cacWithoutRewardsMinor)}</dd>
                <dt>{t("growth.perf.cacWith")}</dt><dd>{money(d.blended.cacWithRewardsMinor)}</dd>
                <dt>{t("growth.perf.mer")}</dt><dd>{d.blended.mer === null ? "—" : d.blended.mer === "<10" ? "<10" : fmtN(d.blended.mer)}</dd></dl>
              {d.blended.hidden && <p className="mt-1 text-xs text-muted-foreground">{why(d.blended.hidden)}</p>}</div>
            <div><h3 className="text-sm font-semibold">{t("growth.perf.mix")}</h3>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="perf-mix">{d.mix.map((m) => <><dt key={`${m.key}-k`}>{t(`growth.perf.mixKinds.${m.key}`, m.key)}</dt><dd key={`${m.key}-v`}>{cnt(m.count)}</dd></>)}</dl></div>
          </div>
          <div><h3 className="text-sm font-semibold">{t("growth.perf.appFunnel")}</h3>
            {!d.appFunnel.storeConnected ? <p className="text-sm text-muted-foreground">{t("growth.perf.storesNotConnected")}</p> :
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="perf-app-funnel"><dt>{t("growth.perf.installs")}</dt><dd>{d.appFunnel.installsStore === null ? "—" : fmtN(d.appFunnel.installsStore)}</dd><dt>{t("growth.perf.registrations")}</dt><dd>{cnt(d.appFunnel.registrations)}</dd><dt>{t("growth.perf.firstBookings")}</dt><dd>{cnt(d.appFunnel.firstCompletedBookings)}</dd>
                <dt>{t("growth.perf.i2r")}</dt><dd>{d.appFunnel.installToRegistrationPct === null ? "—" : `${fmtN(d.appFunnel.installToRegistrationPct)}%`}</dd><dt>{t("growth.perf.r2b")}</dt><dd>{d.appFunnel.registrationToFirstBookingPct === null ? "—" : `${fmtN(d.appFunnel.registrationToFirstBookingPct)}%`}</dd></dl>}</div>
          {d.organic.length > 0 && <DataTable caption={t("growth.perf.organic")} rows={d.organic} rowKey={(r) => r.template} columns={[{ key: "t", header: t("growth.perf.template"), cell: (r) => <code className="text-xs" dir="ltr">{r.template}</code> }, { key: "c", header: t("growth.perf.clicks"), cell: (r) => fmtN(r.clicks) }, { key: "i", header: t("growth.perf.impressions"), cell: (r) => fmtN(r.impressions) }, { key: "r", header: t("growth.perf.ctr"), cell: (r) => (r.ctrPct === null ? "—" : `${fmtN(r.ctrPct)}%`) }]} />}
          <details className="text-sm"><summary className="cursor-pointer font-semibold">{t("growth.perf.definitions")}</summary><ul className="mt-2 list-disc space-y-1 ps-5 text-muted-foreground">{Object.entries(d.definitions).map(([k, v]) => <li key={k}><b>{k}</b>: {v}</li>)}<li>{t("growth.perf.floor", { amount: formatMinor(d.spendFloorMinor, lang), k: d.kMin })}</li></ul></details>
        </div>); })()}
    </Section>
  );
}
