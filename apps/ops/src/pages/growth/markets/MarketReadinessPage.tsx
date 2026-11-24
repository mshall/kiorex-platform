import { useTranslation } from "react-i18next";
import { useReadiness, type ReadinessStatus } from "@/api/marketOnboarding";
import { StatusChip } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { Section } from "@/components/growth/GrowthPage";

const TONE: Record<ReadinessStatus, "success" | "warning" | "info" | "neutral"> = { DONE: "success", TODO: "warning", AWAITING_CHECKER: "info", NEEDS_HUMAN: "neutral" };
/** The readiness checklist of a market plan. NEEDS_HUMAN rows are counsel, legal and gate items that no code or button can close; "ready" is not "live". */
export default function MarketReadinessPage({ cc }: { cc: string }) {
  const { t } = useTranslation(); const q = useReadiness(cc);
  if (q.isLoading) return <CardSkeleton rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data!;
  return (
    <Section title={t("growth.marketWizard.readiness")} id="mw-readiness" hint={t("growth.marketWizard.readinessHint")}>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="readiness-summary">
        <StatusChip tone={r.ready ? "success" : "warning"}>{r.ready ? t("growth.marketWizard.readyYes") : t("growth.marketWizard.readyNo", { n: r.todo })}</StatusChip>
        <StatusChip tone={r.live ? "success" : "neutral"}>{r.live ? t("growth.marketWizard.liveYes") : t("growth.marketWizard.liveNo")}</StatusChip>
        {r.dataCell && <span className="text-muted-foreground">{t("growth.marketWizard.cellLine", { cell: r.dataCell })}{r.sameCellMarkets.length > 0 ? ` ${t("growth.marketWizard.sameCell", { markets: r.sameCellMarkets.join(", ") })}` : ""}</span>}
      </p>
      <ul className="space-y-2" data-testid="readiness-list">
        {r.items.map((i) => (
          <li key={i.id} className="flex min-w-0 flex-wrap items-start gap-2 rounded-xl border bg-card p-3 text-sm" data-testid={`ready-${i.id}`}>
            <StatusChip tone={TONE[i.status]} dot={false}>{t(`growth.marketWizard.status.${i.status}`)}</StatusChip>
            <span className="min-w-0 flex-1"><strong>{t(`growth.marketWizard.item.${i.id}`)}</strong><span className="block break-words text-muted-foreground" dir="auto">{i.detail}</span>{i.humanOwner && <span className="block text-xs text-muted-foreground">{t("growth.marketWizard.humanOwner", { who: t(`growth.marketWizard.owner.${i.humanOwner}`, i.humanOwner) })}</span>}</span>
          </li>))}
      </ul>
    </Section>
  );
}
