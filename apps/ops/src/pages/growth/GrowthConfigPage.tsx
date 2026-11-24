import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useConfigKinds } from "@/api/growth";
import { ConfigPanel } from "@/components/growth/ConfigPanel";
import { GrowthPage, MarketSelect, selectCls, useGrowthMarket } from "@/components/growth/GrowthPage";

/** Configuration versions: every Phase 1 config kind in one place, with the same maker-checker panel the topic pages embed. */
export default function GrowthConfigPage() {
  const { t } = useTranslation(); const g = useGrowthMarket(); const kinds = useConfigKinds().data ?? [];
  const [sp, setSp] = useSearchParams(); const kind = sp.get("kind") && kinds.some((k) => k.kind === sp.get("kind")) ? sp.get("kind")! : kinds[0]?.kind ?? "ATTRIBUTION_POLICY";
  return (
    <GrowthPage section="config" toolbar={<><MarketSelect g={g} /><label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.config.colKind")}</span><select className={selectCls} value={kind} onChange={(e) => setSp({ kind: e.target.value })} data-testid="config-kind">{(kinds.length ? kinds.map((k) => k.kind) : [kind]).map((k) => <option key={k} value={k}>{k}</option>)}</select></label></>}>
      <ConfigPanel key={`${kind}-${g.market}`} kind={kind} market={g.market} showScopePicker={g.show} />
    </GrowthPage>
  );
}
