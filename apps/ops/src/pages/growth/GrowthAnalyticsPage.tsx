import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fmtMasked, useGrowthAnalytics, useJChannels, useJFunnel } from "@/api/growth";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { StatusChip } from "@/components/kit";
import { DaysSelect, GrowthPage, MarketSelect, Section, useGrowthMarket } from "@/components/growth/GrowthPage";

/** Growth analytics: daily counts from the raw growth tables. The definitions, k-anonymity and dimensions of analytics v1 (package J) replace this view when J is registered. */
export default function GrowthAnalyticsPage() {
  const { t } = useTranslation(); const g = useGrowthMarket(); const [days, setDays] = useState(14);
  const q = useGrowthAnalytics(g.market, days); const jf = useJFunnel(days).data; const jc = useJChannels(days).data;
  const table = useMemo(() => {
    const byDay = new Map<string, Record<string, number>>();
    for (const e of q.data?.events ?? []) byDay.set(e.day, { ...(byDay.get(e.day) ?? {}), [e.name]: e.count });
    for (const d of q.data?.decisions ?? []) byDay.set(d.day, { ...(byDay.get(d.day) ?? {}), [`decision:${d.origin}`]: d.count });
    return [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, v]) => ({ day, v }));
  }, [q.data]);
  const cols = ["PageViewed", "SearchStarted", "ProviderViewed", "BookingInitiated", "BookingConfirmed", "BookingAttended", "decision:PROVIDER_LED", "decision:MARKETPLACE"];
  return (
    <GrowthPage section="analytics" toolbar={<><MarketSelect g={g} /><DaysSelect value={days} onChange={setDays} /></>}>
      {jf && (
        <Section title={t("growth.analytics.funnel")} id="an-funnel" hint={t("growth.analytics.funnelHint")}>
          <DataTable caption={t("growth.analytics.funnel")} rows={jf.stages} rowKey={(r) => r.stage} columns={[
            { key: "s", header: t("growth.analytics.stage"), cell: (r) => t(`growth.events.${r.stage}`, r.stage) }, { key: "c", header: t("growth.analytics.count"), cell: (r) => <span className="kx-label-num" data-testid={`jf-${r.stage}`}>{fmtMasked(r.count)}</span> },
            { key: "st", header: t("growth.analytics.step"), cell: (r) => <span className="kx-label-num">{fmtMasked(r.stepConversionPct, "%")}</span> }, { key: "cu", header: t("growth.analytics.cumulative"), cell: (r) => <span className="kx-label-num">{fmtMasked(r.cumulativeConversionPct, "%")}</span> },
          ]} />
        </Section>)}
      {jc && jc.rows.length > 0 && (
        <Section title={t("growth.analytics.channels")} id="an-channels" hint={t("growth.analytics.channelsHint")}>
          <DataTable caption={t("growth.analytics.channels")} rows={jc.rows} rowKey={(r) => `${r.sourceKind}-${r.campaign ?? ""}`} columns={[
            { key: "k", header: t("growth.channels.colKind"), cell: (r) => t(`growth.sourceKind.${r.sourceKind}`, r.sourceKind ?? "—") }, { key: "b", header: t("growth.analytics.bookings"), cell: (r) => <span className="kx-label-num">{fmtMasked(r.bookings)}</span> },
            { key: "a", header: t("growth.analytics.anp"), cell: (r) => <span className="kx-label-num">{fmtMasked(r.attendedNewPatients)}</span> },
          ]} />
        </Section>)}
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <Section title={t("growth.analytics.daily")} id="an-daily" hint={q.data.note}>
          <p className="mb-3"><StatusChip tone="info" data-testid="analytics-source">{t("growth.analytics.rawSource")}</StatusChip></p>
          <DataTable caption={t("growth.analytics.daily")} rows={table} rowKey={(r) => r.day} empty={t("growth.common.noData")} columns={[
            { key: "day", header: t("growth.analytics.day"), cell: (r) => <span className="kx-label-num">{r.day}</span> },
            ...cols.map((c) => ({ key: c, header: c.startsWith("decision:") ? t(`growth.origin.${c.slice(9)}`) : t(`growth.events.${c}`), cell: (r: { v: Record<string, number> }) => <span className="kx-label-num">{r.v[c] ?? 0}</span> })),
          ]} />
        </Section>)}
    </GrowthPage>
  );
}
