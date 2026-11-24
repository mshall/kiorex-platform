import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useModelComparison, useModelLift, type ModelBlock, type ModelComparison } from "@/api/attributionModels";
import { StatCard, StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";

const conv = (v: number | "<10") => (v === "<10" ? "<10" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(v));
const money = (v: number | "<10") => (v === "<10" ? "<10" : fmtN(Math.round(v / 100)));

/** Side-by-side model comparison: every model reconciles to the same total (shown), POSITION_BASED is the default column. Cells under 10 paths read "<10". */
export function ComparisonTable({ data }: { data: ModelComparison }) {
  const { t } = useTranslation();
  const avail = data.models.filter((m) => m.available);
  const kinds = [...new Set(avail.flatMap((m) => m.rows.map((r) => r.sourceKind)))].sort();
  const cell = (m: ModelBlock, kind: string) => m.rows.find((r) => r.sourceKind === kind);
  return (
    <div className="max-h-[72vh] overflow-auto rounded-xl border bg-card shadow-card" role="region" aria-label={t("growth.attributionModels.tableCaption")} tabIndex={0}>
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-start text-sm" data-testid="models-table">
        <caption className="sr-only">{t("growth.attributionModels.tableCaption")}</caption>
        <thead><tr>
          <th scope="col" className="sticky top-0 border-b bg-muted px-3.5 py-2.5 text-start text-xs font-semibold text-muted-foreground">{t("growth.attributionModels.source")}</th>
          {avail.map((m) => <th key={m.model} scope="col" className="sticky top-0 border-b bg-muted px-3.5 py-2.5 text-start text-xs font-semibold text-muted-foreground" data-testid={`col-${m.model}`}>{t(`growth.attributionModels.model.${m.model}`)}{m.isDefault && <> <StatusChip tone="info" dot={false}>{t("growth.attributionModels.default")}</StatusChip></>}</th>)}
        </tr></thead>
        <tbody>
          {kinds.map((k) => (
            <tr key={k}><th scope="row" className="border-b border-border/60 px-3.5 py-3 text-start font-medium">{t(`growth.attributionModels.kind.${k}`, k)}</th>
              {avail.map((m) => { const c = cell(m, k); return <td key={m.model} className="border-b border-border/60 px-3.5 py-3 tabular-nums" data-testid={`cell-${m.model}-${k}`}>{c ? <>{conv(c.conversions)}<span className="block text-xs text-muted-foreground">{money(c.revenueMinor)}</span></> : "—"}</td>; })}
            </tr>
          ))}
          <tr className="font-semibold"><th scope="row" className="px-3.5 py-3 text-start">{t("growth.attributionModels.total")}</th>
            {avail.map((m) => <td key={m.model} className="px-3.5 py-3 tabular-nums" data-testid={`total-${m.model}`}>{conv(Math.round(m.total.conversions * 10) / 10)}<span className="block text-xs font-normal text-muted-foreground">{money(m.total.revenueMinor)}</span></td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ModelCompare({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation(); const q = useModelComparison({ from, to }); const [key, setKey] = useState(""); const lift = useModelLift(key);
  return (
    <div className="space-y-5">
      <p className="rounded-xl border bg-card p-3 text-sm" data-testid="models-reporting-only">{t("growth.attributionModels.reportingOnly")}</p>
      {q.isLoading ? <CardSkeleton rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label={t("growth.attributionModels.status")}>
            <StatCard label={t("growth.attributionModels.reconciled")} value={<span data-testid="reconciled">{q.data.reconciled ? t("growth.attributionModels.yes") : t("growth.attributionModels.no")}</span>} hint={t("growth.attributionModels.reconciledHint")} tone={q.data.reconciled ? "ok" : "warn"} />
            <StatCard label={t("growth.attributionModels.defaultModel")} value={t(`growth.attributionModels.model.${q.data.defaultModel}`)} hint={t("growth.attributionModels.defaultWhy")} />
            <StatCard label={t("growth.attributionModels.dataDriven")} value={<span data-testid="dd-status">{q.data.dataDriven.status === "OK" ? t("growth.attributionModels.ddOk") : t("growth.attributionModels.ddInsufficient")}</span>} hint={t("growth.attributionModels.ddHint", { n: fmtN(q.data.dataDriven.conversions90d), needed: fmtN(q.data.dataDriven.needed) })} tone={q.data.dataDriven.status === "OK" ? "ok" : undefined} />
          </section>
          <Section title={t("growth.attributionModels.compare")} id="am-compare" hint={t("growth.attributionModels.compareHint")}><ComparisonTable data={q.data} /></Section>
        </>
      )}
      <Section title={t("growth.attributionModels.lift")} id="am-lift" hint={t("growth.attributionModels.liftHint")}>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.attributionModels.experimentKey")}</span>
          <input className="h-11 w-72 max-w-full rounded-xl border bg-card px-3 font-mono text-sm" dir="ltr" value={key} maxLength={80} onChange={(e) => setKey(e.target.value.trim())} data-testid="lift-key" /></label>
        <div className="mt-3" aria-live="polite" data-testid="lift-result">
          {key.length < 2 ? null : lift.isLoading ? <CardSkeleton rows={1} /> : lift.error ? <p className="text-sm text-muted-foreground">{t("growth.attributionModels.liftNotFound")}</p> : lift.data && (lift.data.available
            ? <p className="text-sm"><StatusChip tone={lift.data.lift.significant ? "success" : "neutral"}>{t("growth.attributionModels.liftLabel")}</StatusChip> {t("growth.attributionModels.liftSummary", { pp: lift.data.lift.absoluteLiftPp, lo: lift.data.lift.ciLowPp, hi: lift.data.lift.ciHighPp, p: lift.data.lift.pValue })}</p>
            : <p className="text-sm text-muted-foreground">{t(`growth.attributionModels.liftReason.${lift.data.reason}`, lift.data.message)}</p>)}
        </div>
      </Section>
    </div>
  );
}
