import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSponsoredQueue } from "@/api/sponsoredPromotions";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";
import { fmtN } from "@/lib/growthFormat";
import { formatDateTime } from "@/lib/format";

const tone = (d: string | null) => (d === "APPROVED" ? "success" : d === "REJECTED" ? "danger" : d ? "warning" : "neutral") as "success" | "danger" | "warning" | "neutral";

/** Review queue of provider-sponsored promotions (GRW-P2-S): IN_REVIEW first; each row shows which of the reviews (wording, scope, second approver) are decided. */
export default function PromotionsQueuePage() {
  const { t, i18n } = useTranslation(); const [status, setStatus] = useState<"IN_REVIEW" | "ACTIVE" | "ALL">("IN_REVIEW"); const q = useSponsoredQueue(status);
  return (
    <Section title={t("growth.sponsored.queue")} id="sp-queue" hint={t("growth.sponsored.queueHint")}>
      <p className="mb-3 rounded-xl border bg-card p-3 text-sm" data-testid="sponsored-note">{t("growth.sponsored.ownerNote")}</p>
      <div role="group" aria-label={t("growth.sponsored.filter")} className="mb-3 flex flex-wrap gap-2">
        {(["IN_REVIEW", "ACTIVE", "ALL"] as const).map((s) => <button key={s} type="button" aria-pressed={status === s} className={`h-11 rounded-xl border px-4 text-sm font-semibold ${status === s ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`} onClick={() => setStatus(s)} data-testid={`sp-filter-${s}`}>{t(`growth.sponsored.filters.${s}`)}</button>)}
      </div>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("growth.sponsored.queue")} rows={q.data ?? []} rowKey={(r) => `${r.promotionId}-${r.version}`} empty={t("growth.sponsored.empty")} columns={[
          { key: "n", header: t("growth.sponsored.colName"), cell: (r) => <Link className="font-semibold text-primary hover:underline" to={`/growth/sponsored-promotions/${encodeURIComponent(r.promotionId)}`}>{i18n.language.startsWith("ar") ? r.nameAr || r.nameEn : r.nameEn || r.nameAr}</Link> },
          { key: "o", header: t("growth.sponsored.colOrg"), cell: (r) => <code className="text-xs" dir="ltr">{r.orgRef}</code> },
          { key: "s", header: t("growth.sponsored.colStatus"), cell: (r) => <StatusChip tone={r.status === "ACTIVE" ? "success" : r.status === "IN_REVIEW" ? "info" : "neutral"}>{t(`growth.sponsored.status.${r.status}`, r.status)}</StatusChip> },
          { key: "b", header: t("growth.sponsored.colBudget"), cell: (r) => <span className="tabular-nums">{fmtN(Math.round(r.budgetCapMinor / 100))}</span> },
          { key: "r", header: t("growth.sponsored.colReviews"), cell: (r) => <span className="flex flex-wrap gap-1">{r.reviews.map((x) => <StatusChip key={x.kind} tone={tone(x.decision)} dot={false}>{t(`growth.sponsored.kind.${x.kind}`)}</StatusChip>)}</span> },
          { key: "u", header: t("growth.sponsored.colUpdated"), cell: (r) => <span className="text-xs">{formatDateTime(r.updatedAt, i18n.language)}</span> },
        ]} />
      )}
    </Section>
  );
}
