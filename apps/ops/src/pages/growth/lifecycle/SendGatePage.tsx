import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLifecycleDecisions, type DecisionRow } from "@/api/lifecycle";
import { DataTable, type Column } from "@/components/DataTable";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { DaysSelect, GrowthPage, MarketSelect, useGrowthMarket } from "@/components/growth/GrowthPage";
import { StatusChip } from "@/components/kit";
import { ClassBadge } from "./Page";

/** Send-gate decisions by journey and reason code. Counts only: there is no per-person view here (the audited lookup for the DPO is an API call). */
export default function SendGatePage() {
  const { t } = useTranslation(); const g = useGrowthMarket(); const [days, setDays] = useState(7);
  const q = useLifecycleDecisions(g.market, days);
  const rows = q.data ?? [];
  const sent = rows.filter((r) => r.decision === "SEND").reduce((n, r) => n + r.count, 0); const skipped = rows.filter((r) => r.decision === "SKIP").reduce((n, r) => n + r.count, 0);
  const cols: Column<DecisionRow>[] = [
    { key: "journey", header: t("growth.lifecycle.colJourney"), cell: (r) => t(`growth.lifecycle.journey.${r.journeyKey}`, { defaultValue: r.journeyKey }) },
    { key: "class", header: t("growth.lifecycle.colClass"), cell: (r) => <ClassBadge c={r.messageClass} /> },
    { key: "decision", header: t("growth.lifecycle.colDecision"), cell: (r) => <StatusChip tone={r.decision === "SEND" ? "success" : "neutral"}>{t(`growth.lifecycle.decision.${r.decision}`)}</StatusChip> },
    { key: "reason", header: t("growth.lifecycle.colReason"), cell: (r) => <div><span className="font-mono text-xs">{r.reason}</span><p className="text-xs text-muted-foreground">{t(`growth.lifecycle.reason.${r.reason}`, { defaultValue: "" })}</p></div> },
    { key: "count", header: t("growth.lifecycle.colCount"), cell: (r) => <span className="tabular-nums">{r.count}</span> },
  ];
  return (
    <GrowthPage section="lifecycle" toolbar={<><MarketSelect g={g} /><DaysSelect value={days} onChange={setDays} /></>} actions={<Link to="/growth/lifecycle" className="inline-flex h-11 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-accent">{t("growth.lifecycle.back")}</Link>}>
      <p className="rounded-xl bg-info-soft p-3 text-sm text-info">{t("growth.lifecycle.gateHint")}</p>
      <p className="text-sm" data-testid="gate-totals">{t("growth.lifecycle.gateTotals", { sent, skipped })}</p>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <DataTable columns={cols} rows={rows} rowKey={(r) => `${r.journeyKey}|${r.decision}|${r.reason}`} caption={t("growth.lifecycle.sendGate")} empty={<EmptyState title={t("growth.lifecycle.gateEmpty")} />} />}
    </GrowthPage>
  );
}
