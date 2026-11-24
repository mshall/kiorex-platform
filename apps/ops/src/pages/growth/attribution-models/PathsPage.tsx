import { useTranslation } from "react-i18next";
import { useModelPaths } from "@/api/attributionModels";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";

/** Common conversion paths: ordered source KINDS only (never an id or a person), and only paths shared by 10 or more conversions. */
export default function PathsPage({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation(); const q = useModelPaths({ from, to });
  if (q.isLoading) return <CardSkeleton rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-5">
      <p className="rounded-xl border bg-card p-3 text-sm" data-testid="paths-privacy">{t("growth.attributionModels.pathsPrivacy", { k: d.k })}</p>
      <Section title={t("growth.attributionModels.paths")} id="am-paths">
        <DataTable caption={t("growth.attributionModels.paths")} rows={d.paths} rowKey={(r) => r.pathHash} empty={t("growth.attributionModels.pathsEmpty")} columns={[
          { key: "p", header: t("growth.attributionModels.path"), cell: (r) => <span className="flex flex-wrap items-center gap-1" dir="ltr">{r.kinds.map((k, i) => <span key={i} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{t(`growth.attributionModels.kind.${k}`, k)}</span>)}</span> },
          { key: "l", header: t("growth.attributionModels.length"), cell: (r) => fmtN(r.length) },
          { key: "c", header: t("growth.attributionModels.conversions"), cell: (r) => <span className="tabular-nums">{fmtN(r.conversions)}</span> },
        ]} />
      </Section>
      <Section title={t("growth.attributionModels.lengths")} id="am-lengths">
        <DataTable caption={t("growth.attributionModels.lengths")} rows={d.lengthDistribution} rowKey={(r) => String(r.length)} empty={t("growth.attributionModels.pathsEmpty")} columns={[
          { key: "l", header: t("growth.attributionModels.length"), cell: (r) => fmtN(r.length) }, { key: "c", header: t("growth.attributionModels.conversions"), cell: (r) => fmtN(r.conversions) },
        ]} />
      </Section>
    </div>
  );
}
