import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fmtN } from "@/lib/growthFormat";
import { useProviderAcquisition } from "@/api/growth";
import { useLeadFunnel } from "@/api/partnerLeads";
import { StatCard } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { BarList } from "@/components/growth/BarList";
import { DaysSelect, GrowthPage, MarketSelect, Section, useGrowthMarket } from "@/components/growth/GrowthPage";

/** Provider acquisition: the supply funnel is the existing Partner leads page (linked, not copied); this page adds provider-owned link and QR usage. */
export default function GrowthProvidersPage() {
  const { t } = useTranslation(); const g = useGrowthMarket(); const [days, setDays] = useState(30);
  const q = useProviderAcquisition(g.market, days); const funnel = useLeadFunnel(days);
  return (
    <GrowthPage section="providers" toolbar={<><MarketSelect g={g} /><DaysSelect value={days} onChange={setDays} /></>}
      actions={<Link to="/partner-leads" className="text-sm font-semibold text-primary hover:underline" data-testid="providers-leads-link">{t("growth.providers.openLeads")}</Link>}>
      <Section title={t("growth.providers.supply")} id="pa-supply" hint={t("growth.providers.supplyHint")}>
        {funnel.isLoading ? <CardSkeleton rows={1} /> : funnel.data ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="providers-funnel">{funnel.data.stages.map((s) => <StatCard key={s.stage} label={t(`growth.providers.stage.${s.stage}`)} value={fmtN(s.count)} hint={s.fromPrevious === null ? undefined : t("growth.providers.fromPrevious", { pct: Math.round(s.fromPrevious) })} />)}</div>
        ) : <p className="text-sm text-muted-foreground">{t("growth.common.noData")}</p>}
      </Section>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={t("growth.providers.owned")} id="pa-owned" hint={t("growth.providers.ownedHint", { count: q.data.ownedSources })}>
            {q.data.sourcesByKind.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.providers.noLinks")}</p> : <BarList testid="owned-kinds" rows={q.data.sourcesByKind.map((k) => ({ label: t(`growth.sourceKind.${k.sourceKind}`, k.sourceKind), value: k.count }))} />}
          </Section>
          <Section title={t("growth.providers.top")} id="pa-top" hint={t("growth.providers.topHint")}>
            {q.data.topOrganisations.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.common.noData")}</p> : <BarList testid="top-orgs" tone="ocean" rows={q.data.topOrganisations.map((o) => ({ label: o.orgRef, value: o.touches }))} />}
          </Section>
        </div>)}
    </GrowthPage>
  );
}
