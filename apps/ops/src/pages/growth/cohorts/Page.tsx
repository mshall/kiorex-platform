import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCohortRollup } from "@/api/cohorts";
import { useGrowthAccess } from "@/api/growth";
import { GrowthPage } from "@/components/growth/GrowthPage";
import CohortsPage from "./CohortsPage";
import LtvPage from "./LtvPage";
import PaybackPage from "./PaybackPage";

const TABS = ["cohorts", "ltv", "payback"] as const;

/** GRW-P3-C: cohort tables, retention heatmap, LTV with intervals and payback against blended CAC (replaces the GRW-P2-X1 placeholder). Aggregates only; "<10" is a privacy floor, not missing data. */
export default function CohortsRoute() {
  const { t } = useTranslation(); const [tab, setTab] = useState<(typeof TABS)[number]>("cohorts"); const access = useGrowthAccess(); const roll = useCohortRollup();
  const canManage = !!access.data?.capabilities.manage;
  return (
    <GrowthPage section="cohorts" actions={canManage ? <button type="button" className="h-11 rounded-xl border border-input bg-card px-4 text-sm font-semibold" disabled={roll.isPending} onClick={() => roll.mutate(24)} data-testid="cohort-rollup">{roll.isPending ? t("growth.cohorts.recomputing") : t("growth.cohorts.recompute")}</button> : undefined}>
      <div role="tablist" aria-label={t("growth.cohorts.tabs")} className="flex flex-wrap gap-2" data-testid="cohort-tabs">
        {TABS.map((k) => <button key={k} id={`coh-tab-${k}`} role="tab" type="button" aria-selected={tab === k} aria-controls="coh-panel" className={`h-11 rounded-xl border px-4 text-sm font-semibold ${tab === k ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`} onClick={() => setTab(k)} data-testid={`coh-tab-${k}`}>{t(`growth.cohorts.tab.${k}`)}</button>)}
      </div>
      {roll.isSuccess && <p className="rounded-xl border bg-card p-3 text-sm" role="status">{t("growth.cohorts.recomputed")}</p>}
      <div id="coh-panel" role="tabpanel" aria-labelledby={`coh-tab-${tab}`}>{tab === "cohorts" ? <CohortsPage /> : tab === "ltv" ? <LtvPage /> : <PaybackPage />}</div>
    </GrowthPage>
  );
}
