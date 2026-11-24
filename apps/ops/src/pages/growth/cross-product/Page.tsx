import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GrowthPage, DaysSelect } from "@/components/growth/GrowthPage";
import { CardSkeleton, ErrorState } from "@/components/states";
import { useCrossProductFunnel } from "@/api/crossProduct";
import CrossProductPage from "./CrossProductPage";
import FunnelPage from "./FunnelPage";

const TABS = ["overview", "funnel"] as const;

/** GRW-P4-A: cross-product journeys (clinic to pharmacy, lab and home visit). Measurement only: no reward, no charge, no clinical data, k >= 10. */
export default function CrossProductRoutePage() {
  const { t } = useTranslation(); const [tab, setTab] = useState<(typeof TABS)[number]>("overview"); const [days, setDays] = useState(30);
  const q = useCrossProductFunnel(days);
  return (
    <GrowthPage section="cross-product" toolbar={<DaysSelect value={days} onChange={setDays} />}>
      <div role="tablist" aria-label={t("growth.crossProduct.tabs")} className="flex flex-wrap gap-2" data-testid="cp-tabs">
        {TABS.map((k) => <button key={k} id={`cp-tab-${k}`} role="tab" type="button" aria-selected={tab === k} aria-controls="cp-panel" className={`h-11 rounded-xl border px-4 text-sm font-semibold ${tab === k ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`} onClick={() => setTab(k)}>{t(`growth.crossProduct.tab.${k}`)}</button>)}
      </div>
      <div id="cp-panel" role="tabpanel" aria-labelledby={`cp-tab-${tab}`}>
        {q.isLoading ? <CardSkeleton rows={3} /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : tab === "overview" ? <CrossProductPage data={q.data} /> : <FunnelPage data={q.data} />}
      </div>
    </GrowthPage>
  );
}
