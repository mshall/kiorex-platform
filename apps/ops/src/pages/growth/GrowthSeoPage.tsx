import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GrowthPage } from "@/components/growth/GrowthPage";
import LinksTab from "./seo/LinksTab";
import OverviewTab from "./seo/OverviewTab";
import QualityTab from "./seo/QualityTab";
import VitalsTab from "./seo/VitalsTab";

const TABS = ["overview", "quality", "links", "vitals"] as const;

/** SEO management: the Phase 1 overview (metadata thresholds, robots and sitemap, slugs, redirects) plus the GRW-P3-F quality gate, link graph and vitals tabs. */
export default function GrowthSeoPage() {
  const { t } = useTranslation(); const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  return (
    <GrowthPage section="seo">
      <div role="tablist" aria-label={t("growth.seoAuto.tabs")} className="flex flex-wrap gap-2" data-testid="seo-tabs">
        {TABS.map((k) => <button key={k} id={`seo-tab-${k}`} role="tab" type="button" aria-selected={tab === k} aria-controls="seo-panel" className={`h-11 rounded-xl border px-4 text-sm font-semibold ${tab === k ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`} onClick={() => setTab(k)}>{t(`growth.seoAuto.tab.${k}`)}</button>)}
      </div>
      <div id="seo-panel" role="tabpanel" aria-labelledby={`seo-tab-${tab}`}>{tab === "overview" ? <OverviewTab /> : tab === "quality" ? <QualityTab /> : tab === "links" ? <LinksTab /> : <VitalsTab />}</div>
    </GrowthPage>
  );
}
