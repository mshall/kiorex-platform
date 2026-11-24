import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useGrowthAccess } from "@/api/growth";
import { useSeoIndexation, useSeoVitals, useVitalsIngest } from "@/api/seoAutomation";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";

const unit = (m: string) => (m === "cls" ? "" : m === "perf_score" ? "" : " ms");

/** Core Web Vitals by template (lab and field), the budgets, the production-indexing readiness rows, and indexation per template group. "Not measured" is said plainly: nothing is estimated. */
export default function VitalsTab() {
  const { t } = useTranslation(); const v = useSeoVitals(); const ix = useSeoIndexation(); const ingest = useVitalsIngest(); const can = useGrowthAccess().data?.capabilities.manage;
  if (v.isLoading) return <CardSkeleton rows={3} />;
  if (v.error || !v.data) return <ErrorState error={v.error} onRetry={() => void v.refetch()} />;
  const d = v.data; const breach = new Set(d.breaches.map((b) => `${b.templateKind}|${b.metric}|${b.source}`));
  const budgetOf = (m: string) => ({ lcp_ms: d.budgets.lcpMs, inp_ms: d.budgets.inpMs, cls: d.budgets.cls, tbt_ms: d.budgets.tbtMs, perf_score: d.budgets.perfScore }[m] ?? 0);
  const part = (title: string, src: "LAB" | "FIELD", info: { measured: boolean; note?: string }) => (
    <Section title={title} id={`seov-${src}`}>
      {!info.measured ? <p className="text-sm" data-testid={`vitals-${src.toLowerCase()}-none`}>{info.note}</p> : (
        <DataTable caption={title} rows={d.latest.filter((x) => x.source === src)} rowKey={(r) => `${r.templateKind}|${r.metric}`} empty="—" columns={[
          { key: "t", header: t("growth.seoAuto.template"), cell: (r) => <code className="text-xs">{r.templateKind}</code> }, { key: "m", header: t("growth.seoAuto.metric"), cell: (r) => <code className="text-xs">{r.metric}</code> },
          { key: "v", header: t("growth.seoAuto.value"), cell: (r) => <span className="kx-label-num">{r.p75}{unit(r.metric)}</span> }, { key: "b", header: t("growth.seoAuto.budget"), cell: (r) => <span className="kx-label-num">{budgetOf(r.metric)}{unit(r.metric)}</span> },
          { key: "s", header: "", cell: (r) => <StatusChip tone={breach.has(`${r.templateKind}|${r.metric}|${r.source}`) ? "danger" : "success"}>{breach.has(`${r.templateKind}|${r.metric}|${r.source}`) ? t("growth.seoAuto.breach") : t("growth.seoAuto.ok")}</StatusChip> },
        ]} />
      )}
    </Section>
  );
  return (
    <div className="space-y-5" data-testid="seo-vitals-tab">
      {can && <Button variant="outline" disabled={ingest.isPending} onClick={() => ingest.mutate(undefined, { onSuccess: () => toast.success(t("growth.seoAuto.ingested")), onError: (e) => toast.error((e as Error).message) })} data-testid="vitals-ingest">{t("growth.seoAuto.ingest")}</Button>}
      <Section title={t("growth.seoAuto.readiness")} id="seov-ready">
        <ul className="space-y-1 text-sm" data-testid="vitals-readiness">{d.readiness.productionIndexing.map((r) => <li key={r.key} className="flex items-center gap-2"><StatusChip tone={r.ok ? "success" : "warning"}>{r.ok ? "✓" : "—"}</StatusChip>{t(`growth.seoAuto.ready.${r.key}`)}</li>)}</ul>
      </Section>
      {part(t("growth.seoAuto.labTitle"), "LAB", d.lab)}
      {part(t("growth.seoAuto.fieldTitle"), "FIELD", d.field)}
      <Section title={t("growth.seoAuto.indexation")} id="seov-index" hint={ix.data?.note}>
        {ix.isLoading ? <CardSkeleton rows={2} /> : ix.error || !ix.data ? <ErrorState error={ix.error} onRetry={() => void ix.refetch()} /> : (
          <DataTable caption={t("growth.seoAuto.indexation")} rows={ix.data.rows} rowKey={(r) => r.templateKind} empty={t("growth.seoAuto.notMeasured")} columns={[
            { key: "t", header: t("growth.seoAuto.template"), cell: (r) => <code className="text-xs">{r.templateKind}</code> }, { key: "s", header: t("growth.seoAuto.submitted"), cell: (r) => <span className="kx-label-num">{fmtN(r.submitted)}</span> },
            { key: "i", header: t("growth.seoAuto.indexed"), cell: (r) => (r.indexedKnown && r.indexed !== null ? <span className="kx-label-num">{fmtN(r.indexed)}</span> : <span className="text-xs text-muted-foreground" data-testid={`indexed-${r.templateKind}`}>{t("growth.seoAuto.indexedUnknown")}</span>) },
            { key: "e", header: t("growth.seoAuto.excluded"), cell: (r) => <span className="kx-label-num">{fmtN(r.excluded)}</span> },
            { key: "r", header: t("growth.seoAuto.reasons"), cell: (r) => <span className="text-xs">{Object.entries(r.reasons).map(([k, n]) => `${k} ${n}`).join(" · ") || "—"}</span> },
          ]} />
        )}
      </Section>
    </div>
  );
}
