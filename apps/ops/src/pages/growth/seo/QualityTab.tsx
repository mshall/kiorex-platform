import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useGrowthAccess } from "@/api/growth";
import { useSeoOverview, useSeoRun } from "@/api/seoAutomation";
import { StatCard, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";

/** Content-quality gate: what was measured, what failed and why, and whether failing pages are only reported or also set noindex (the SEO_AUTOMATION configuration decides). */
export default function QualityTab() {
  const { t } = useTranslation(); const q = useSeoOverview(); const run = useSeoRun(); const can = useGrowthAccess().data?.capabilities.manage;
  if (q.isLoading) return <CardSkeleton rows={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data; const avg = d.byTemplate.length ? Math.round(d.byTemplate.reduce((s, x) => s + x.avgScore * x.pages, 0) / Math.max(1, d.byTemplate.reduce((s, x) => s + x.pages, 0))) : 0;
  const go = () => run.mutate(undefined, { onSuccess: (r) => toast.success(t("growth.seoAuto.ran", { pages: String(r.pages ?? 0), failed: String(r.failedPages ?? 0) })), onError: (e) => toast.error((e as Error).message) });
  return (
    <div className="space-y-5" data-testid="seo-quality-tab">
      <p className="rounded-xl bg-muted/50 p-3 text-sm" data-testid="seo-auto-mode">{d.autoNoindex ? t("growth.seoAuto.autoOn") : t("growth.seoAuto.autoOff")}</p>
      {!d.measured && <p className="rounded-xl border border-warning/40 p-3 text-sm" data-testid="seo-not-measured">{d.bundleAvailable ? t("growth.seoAuto.notMeasured") : t("growth.seoAuto.noBundle")}</p>}
      {can && <Button onClick={go} disabled={run.isPending} data-testid="seo-run">{t("growth.seoAuto.run")}</Button>}
      {d.measured && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="seo-quality-stats">
            <StatCard label={t("growth.seoAuto.pagesChecked")} value={fmtN(d.pagesChecked)} /><StatCard label={t("growth.seoAuto.avgScore")} value={fmtN(avg)} />
            <StatCard label={t("growth.seoAuto.wouldNoindex")} value={fmtN(d.wouldNoindex)} tone={d.wouldNoindex > 0 ? "warn" : "ok"} />
          </div>
          <Section title={t("growth.seoAuto.byTemplate")} id="seoq-templates">
            <DataTable caption={t("growth.seoAuto.byTemplate")} rows={d.byTemplate} rowKey={(r) => r.template} empty={t("growth.seoAuto.empty")} columns={[
              { key: "t", header: t("growth.seoAuto.template"), cell: (r) => <code className="text-xs">{r.template}</code> }, { key: "p", header: t("growth.seoAuto.pages"), cell: (r) => <span className="kx-label-num">{fmtN(r.pages)}</span> },
              { key: "f", header: t("growth.seoAuto.failed"), cell: (r) => <span className="kx-label-num">{fmtN(r.failed)}</span> }, { key: "s", header: t("growth.seoAuto.score"), cell: (r) => <span className="kx-label-num">{fmtN(r.avgScore)}</span> },
              { key: "c", header: t("growth.seoAuto.checks"), cell: (r) => <span className="text-xs">{Object.entries(r.checks).map(([k, n]) => `${t(`growth.seoAuto.check.${k}`)} ${fmtN(n)}`).join(" · ") || "—"}</span> },
            ]} />
          </Section>
          <Section title={t("growth.seoAuto.worst")} id="seoq-worst">
            <DataTable caption={t("growth.seoAuto.worst")} rows={d.worst} rowKey={(r) => `${r.pageKey}|${r.locale}`} empty={t("growth.seoAuto.empty")} columns={[
              { key: "k", header: t("growth.seoAuto.page"), cell: (r) => <code className="text-xs" dir="ltr">{r.pageKey}</code> }, { key: "l", header: t("growth.seoAuto.locale"), cell: (r) => r.locale.toUpperCase() },
              { key: "s", header: t("growth.seoAuto.score"), cell: (r) => <span className="kx-label-num">{fmtN(r.score)}</span> },
              { key: "c", header: t("growth.seoAuto.checks"), cell: (r) => <span className="text-xs">{r.failedChecks.map((k) => t(`growth.seoAuto.check.${k}`)).join(" · ") || "—"}</span> },
              { key: "d", header: t("growth.seoAuto.decision"), cell: (r) => <StatusChip tone={r.noindex ? "danger" : "neutral"}>{r.noindex && d.autoNoindex ? t("growth.seoAuto.noindex") : t("growth.seoAuto.reportOnly")}</StatusChip> },
            ]} />
          </Section>
        </>
      )}
    </div>
  );
}
