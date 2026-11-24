import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fmtN } from "@/lib/growthFormat";
import { Link } from "react-router-dom";
import { fmtMasked, useGrowthAccess, useGrowthFinance, useJOverview } from "@/api/growth";
import { StatCard } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DaysSelect, GrowthPage, MarketSelect, Section, useGrowthMarket } from "@/components/growth/GrowthPage";
import { formatMinor } from "@/lib/format";

/** Financial performance (finance role). Phase 1 shows who brought the bookings that can carry a fee; CAC, ROAS and spend are Phase 2 (GRW-P2-7) and are not faked. */
export default function GrowthFinancePage() {
  const { t, i18n } = useTranslation(); const g = useGrowthMarket(); const [days, setDays] = useState(30);
  const access = useGrowthAccess(); const allowed = !!access.data?.capabilities.readFinance;
  const q = useGrowthFinance(g.market, days, allowed); const j = useJOverview(days).data;
  const money = (v: number | "<10" | null | undefined) => (typeof v === "number" ? formatMinor(v, i18n.language) : fmtMasked(v));
  return (
    <GrowthPage section="finance" toolbar={<><MarketSelect g={g} /><DaysSelect value={days} onChange={setDays} /></>} actions={<Link className="text-sm font-semibold text-primary hover:underline" to="/fees">{t("growth.finance.openFees")}</Link>}>
      {access.isLoading ? <CardSkeleton rows={1} /> : !allowed ? <div role="status" className="kx-card p-6 text-sm" data-testid="finance-denied">{t("growth.finance.denied")}</div> : q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="finance-stats">
            <StatCard label={t("growth.origin.PROVIDER_LED")} value={fmtN(q.data.decisions.providerLed)} hint={t("growth.finance.providerLedHint")} />
            <StatCard label={t("growth.origin.MARKETPLACE")} value={fmtN(q.data.decisions.marketplace)} hint={t("growth.finance.marketplaceHint")} />
            <StatCard label={t("growth.origin.UNATTRIBUTED")} value={fmtN(q.data.decisions.unattributed)} />
            <StatCard label={t("growth.finance.corrections")} value={fmtN(q.data.decisions.corrections)} />
          </div>
          <Section title={t("growth.finance.revenue")} id="fn-revenue" hint={t("growth.finance.revenueHint")}>
            {q.data.revenueFacts ? <div className="grid grid-cols-2 gap-3"><StatCard label={t("growth.finance.charges")} value={formatMinor(q.data.revenueFacts.charges, i18n.language, q.data.revenueFacts.currency)} /><StatCard label={t("growth.finance.reversals")} value={formatMinor(q.data.revenueFacts.reversals, i18n.language, q.data.revenueFacts.currency)} /></div> : <p className="text-sm text-muted-foreground" data-testid="finance-no-facts">{t("growth.finance.noFacts")}</p>}
          </Section>
          {j && j.kiorexRevenueMinor !== undefined && (
            <Section title={t("growth.finance.analyticsV1")} id="fn-a1" hint={t("growth.finance.analyticsV1Hint", { k: j.k })}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="finance-analytics">
                <StatCard label={t("growth.finance.kiorexRevenue")} value={money(j.kiorexRevenueMinor)} hint={t("growth.finance.notGbv")} />
                <StatCard label={t("growth.finance.pending")} value={money(j.commissionPendingMinor)} />
                <StatCard label={t("growth.finance.spend")} value={money(j.spendMinor)} hint={t("growth.finance.spendHint")} />
                <StatCard label={t("growth.finance.cac")} value={money(j.blendedCacMinor ?? null)} />
              </div>
            </Section>)}
          <Section title={t("growth.finance.planned")} id="fn-planned"><p className="text-sm">{t("growth.finance.plannedBody")}</p><p className="mt-2 text-xs text-muted-foreground">{q.data.rule}</p></Section>
        </>)}
    </GrowthPage>
  );
}
