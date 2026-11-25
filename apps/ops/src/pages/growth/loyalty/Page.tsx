import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GrowthPage } from "@/components/growth/GrowthPage";
import LoyaltyPage from "./LoyaltyPage";
import PartnershipsPage from "./PartnershipsPage";
import TiersPage from "./TiersPage";

const TABS = ["overview", "tiers", "partnerships"] as const;
/** GRW-P4-D: loyalty points (overview, tiers and rules) and partnership programs. Points are not money: nothing on these pages can move, top up or withdraw value. */
export default function LoyaltyHostPage() {
  const { t } = useTranslation(); const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  return (
    <GrowthPage section="loyalty">
      <div role="tablist" aria-label={t("growth.loyalty.tabs")} className="flex flex-wrap gap-2">
        {TABS.map((k) => <button key={k} role="tab" type="button" id={`loy-tab-${k}`} aria-selected={tab === k} aria-controls={`loy-panel-${k}`} className={`h-11 rounded-xl border px-5 text-sm font-semibold ${tab === k ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`} onClick={() => setTab(k)} data-testid={`loy-tab-${k}`}>{t(`growth.loyalty.tab.${k}`)}</button>)}
      </div>
      <div role="tabpanel" id={`loy-panel-${tab}`} aria-labelledby={`loy-tab-${tab}`}>{tab === "overview" ? <LoyaltyPage /> : tab === "tiers" ? <TiersPage /> : <PartnershipsPage />}</div>
    </GrowthPage>
  );
}
