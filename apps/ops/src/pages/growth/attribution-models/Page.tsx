import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GrowthPage, DaysSelect } from "@/components/growth/GrowthPage";
import ModelCompare from "./ModelCompare";
import ModelsPage from "./ModelsPage";
import PathsPage from "./PathsPage";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const TABS = ["compare", "paths", "models"] as const;

/** GRW-P3-B: reporting attribution models (replaces the GRW-P2-X1 placeholder). Reporting only; the commission stays on the deterministic decision. */
export default function AttributionModelsPage() {
  const { t } = useTranslation(); const [tab, setTab] = useState<(typeof TABS)[number]>("compare"); const [days, setDays] = useState(30);
  const from = day(-days), to = day(0);
  return (
    <GrowthPage section="attribution-models" toolbar={tab !== "models" ? <DaysSelect value={days} onChange={setDays} /> : undefined}>
      <div role="tablist" aria-label={t("growth.attributionModels.tabs")} className="flex flex-wrap gap-2" data-testid="am-tabs">
        {TABS.map((k) => <button key={k} id={`am-tab-${k}`} role="tab" type="button" aria-selected={tab === k} aria-controls="am-panel" className={`h-11 rounded-xl border px-4 text-sm font-semibold ${tab === k ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`} onClick={() => setTab(k)} data-testid={`am-tab-${k}`}>{t(`growth.attributionModels.tab.${k}`)}</button>)}
      </div>
      <div id="am-panel" role="tabpanel" aria-labelledby={`am-tab-${tab}`}>{tab === "compare" ? <ModelCompare from={from} to={to} /> : tab === "paths" ? <PathsPage from={from} to={to} /> : <ModelsPage />}</div>
    </GrowthPage>
  );
}
