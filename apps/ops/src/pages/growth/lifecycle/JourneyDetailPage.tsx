import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLifecycle, type JourneyStepRow } from "@/api/lifecycle";
import { DataTable, type Column } from "@/components/DataTable";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { GrowthPage, MarketSelect, useGrowthMarket } from "@/components/growth/GrowthPage";
import { ClassBadge } from "./Page";

/** One journey: its steps in order with delay, class and the channel order. Changes to the policy go through the LIFECYCLE_POLICY maker-checker, not here. */
export default function JourneyDetailPage() {
  const { t, i18n } = useTranslation(); const { key } = useParams(); const g = useGrowthMarket(); const ov = useLifecycle(g.market);
  const j = ov.data?.journeys.find((x) => x.key === key); const ar = i18n.language.startsWith("ar");
  const cols: Column<JourneyStepRow>[] = [
    { key: "step", header: "#", cell: (s) => <span className="tabular-nums">{s.step}</span> },
    { key: "class", header: t("growth.lifecycle.colClass"), cell: (s) => <ClassBadge c={s.messageClass} /> },
    { key: "kind", header: t("growth.lifecycle.colTemplate"), cell: (s) => <span className="font-mono text-xs">{s.kind}</span> },
    { key: "channels", header: t("growth.lifecycle.colChannels"), cell: (s) => <span className="text-xs">{s.channels.map((c) => t(`growth.lifecycle.channel.${c}`, { defaultValue: c })).join(" > ")}</span> },
    { key: "delay", header: t("growth.lifecycle.colDelay"), cell: (s) => <span className="tabular-nums text-xs">{s.delayMinutes === 0 ? t("growth.lifecycle.immediately") : t("growth.lifecycle.afterMinutes", { count: s.delayMinutes })}</span> },
  ];
  return (
    <GrowthPage section="lifecycle" toolbar={<MarketSelect g={g} />} actions={<Link to="/growth/lifecycle" className="inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-accent">{t("growth.lifecycle.back")}</Link>}>
      {ov.isLoading ? <CardSkeleton rows={2} /> : ov.isError ? <ErrorState error={ov.error} onRetry={() => void ov.refetch()} /> : !j ? <EmptyState title={t("growth.lifecycle.notFound")} /> : (
        <div className="space-y-3" data-testid="journey-detail">
          <h2 className="text-lg font-semibold">{t(`growth.lifecycle.journey.${j.key}`, { defaultValue: j.key })}</h2>
          <p className="text-sm text-muted-foreground">{ar ? j.describe.ar : j.describe.en}</p>
          <p className="text-xs">{t("growth.lifecycle.trigger")}: <span className="font-mono">{j.trigger}</span> · {j.anchored ? t("growth.lifecycle.perAnchor") : t("growth.lifecycle.perPerson")}</p>
          {j.hasMarketingStep ? <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning" data-testid="journey-marketing-note">{t("growth.lifecycle.marketingNote")}</p> : null}
          <DataTable columns={cols} rows={j.steps} rowKey={(s) => String(s.step)} caption={t("growth.lifecycle.steps")} />
        </div>
      )}
    </GrowthPage>
  );
}
