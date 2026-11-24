import { useTranslation } from "react-i18next";
import { ConfigPanel } from "@/components/growth/ConfigPanel";
import { GrowthPage, Section, useGrowthMarket, MarketSelect } from "@/components/growth/GrowthPage";
import { EvidenceViewer } from "./GrowthPatientsPage";

/** Attribution and commission rules: the versioned ATTRIBUTION_POLICY (windows, precedence, dwell) with the 7-day announcement rule, and the per-booking evidence viewer. */
export default function GrowthAttributionPage() {
  const { t } = useTranslation(); const g = useGrowthMarket();
  return (
    <GrowthPage section="attribution" toolbar={<MarketSelect g={g} />}>
      <Section title={t("growth.attribution.rules")} id="at-rules" hint={t("growth.attribution.rulesHint")}>
        <ul className="list-disc space-y-1 ps-5 text-sm" data-testid="attribution-rules">{[1, 2, 3, 4].map((n) => <li key={n}>{t(`growth.attribution.rule${n}`)}</li>)}</ul>
      </Section>
      <ConfigPanel kind="ATTRIBUTION_POLICY" market={g.market} showScopePicker={g.show} />
      <Section title={t("growth.evidence.title")} id="at-evidence" hint={t("growth.evidence.hint")}><EvidenceViewer /></Section>
    </GrowthPage>
  );
}
