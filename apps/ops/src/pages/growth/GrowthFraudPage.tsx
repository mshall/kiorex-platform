import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GrowthPage } from "@/components/growth/GrowthPage";
import CaseDetailPage from "./fraud/CaseDetailPage";
import CasesTab from "./fraud/CasesTab";
import RulesPage from "./fraud/RulesPage";
import ShadowReportPage from "./fraud/ShadowReportPage";
import SignalsTab from "./fraud/SignalsTab";

const TABS = ["cases", "signals", "rules", "shadow"] as const;

/** Fraud management (GRW-P3-D rebuilt): cases and the review queue, the Phase 1 signals, the rules, and the shadow and fairness report. Fraud never changes an attribution decision, a commission or a booking. */
export default function GrowthFraudPage() {
  const { t } = useTranslation(); const [tab, setTab] = useState<(typeof TABS)[number]>("cases"); const [open, setOpen] = useState<string | null>(null);
  return (
    <GrowthPage section="fraud">
      <div role="tablist" aria-label={t("growth.fraudV2.tabs")} className="flex flex-wrap gap-2" data-testid="fraud-tabs">
        {TABS.map((k) => <button key={k} id={`fraud-tab-${k}`} role="tab" type="button" aria-selected={tab === k} aria-controls="fraud-panel" className={`h-11 rounded-xl border px-4 text-sm font-semibold ${tab === k ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`} onClick={() => { setTab(k); setOpen(null); }}>{t(`growth.fraudV2.tab.${k}`)}</button>)}
      </div>
      <div id="fraud-panel" role="tabpanel" aria-labelledby={`fraud-tab-${tab}`}>
        {tab === "cases" ? (open ? <CaseDetailPage id={open} onBack={() => setOpen(null)} /> : <CasesTab onOpen={setOpen} />) : tab === "signals" ? <SignalsTab /> : tab === "rules" ? <RulesPage /> : <ShadowReportPage />}
      </div>
    </GrowthPage>
  );
}
