import { useTranslation } from "react-i18next";
import { StatCard, StatusChip } from "@/components/kit";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";
import type { Funnel } from "@/api/crossProduct";

/** Overview: is the package effective, how many clinic visits the funnel starts from, and the rules in force (measurement only; no reward, no charge, no clinical data). */
export default function CrossProductPage({ data }: { data: Funnel }) {
  const { t } = useTranslation();
  const n = (v: number | "<10") => <bdi dir="ltr">{v === "<10" ? v : fmtN(v)}</bdi>;
  return (
    <div className="space-y-5" data-testid="cp-overview">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("growth.crossProduct.status")} value={<StatusChip tone={data.enabled ? "success" : "neutral"} data-testid="cp-status">{data.enabled ? t("growth.crossProduct.on") : t("growth.crossProduct.off")}</StatusChip>} hint={t("growth.crossProduct.statusHint")} />
        <StatCard label={t("growth.crossProduct.visits")} value={<span data-testid="cp-visits">{n(data.clinicVisitsCompleted)}</span>} hint={t("growth.crossProduct.visitsHint")} />
        <StatCard label={t("growth.crossProduct.rewards")} value={<span data-testid="cp-rewards">{t("growth.crossProduct.none")}</span>} hint={t("growth.crossProduct.rewardsHint")} />
        <StatCard label={t("growth.crossProduct.commission")} value={<span data-testid="cp-commission">{t("growth.crossProduct.inert")}</span>} hint={t("growth.crossProduct.commissionHint")} />
      </div>
      <Section title={t("growth.crossProduct.rulesTitle")} id="cp-rules">
        <ol className="list-decimal space-y-1 ps-5 text-sm" data-testid="cp-rules">{(t(`growth.crossProduct.${"rules"}`, { returnObjects: true }) as string[]).map((r) => <li key={r}>{r}</li>)}</ol>
      </Section>
      <p className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning" role="note" data-testid="cp-needs-human">{t("growth.crossProduct.needsHuman")}</p>
    </div>
  );
}
