import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Hand } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePartnerConnections } from "@/api/partnerOnboarding";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatusChip, type Tone } from "@/components/kit";
import { EnrolmentCodesPanel } from "@/components/EnrolmentCodesPanel";
import { formatDateTime } from "@/lib/format";

export const PARTNER_TONE: Record<string, Tone> = { SUBMITTED: "info", IN_REVIEW: "info", CHANGES_REQUESTED: "warning", AWAITING_APPROVAL: "brand", APPROVED: "brand", LIVE: "success", PAUSED: "warning", REJECTED: "danger" };

/** Partner onboarding queue: standalone organisations asking to connect to the marketplace. The highlighted column is what a human still has to do. */
export default function PartnerOnboardingPage() {
  const { t, i18n } = useTranslation(); const nav = useNavigate(); const q = usePartnerConnections();
  return (
    <div>
      <PageHeader title={t("pob.title")} hint={t("pob.hint")} />
      <EnrolmentCodesPanel />
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("pob.title")} rows={q.data!} rowKey={(r) => r.id} empty={t("pob.none")} onRowClick={(r) => nav(`/partner-onboarding/${r.id}`)} columns={[
          { key: "o", header: t("pob.partner"), cell: (r) => <div><Link to={`/partner-onboarding/${r.id}`} className="font-bold hover:underline focus-visible:underline" dir="auto" onClick={(e) => e.stopPropagation()}>{i18n.language.startsWith("ar") && r.nameAr ? r.nameAr : r.name}</Link><div className="text-xs text-muted-foreground">{t(`pob.kind.${r.kind}`)} · {r.market}</div></div> },
          { key: "s", header: t("pob.status"), cell: (r) => <StatusChip tone={PARTNER_TONE[r.status] ?? "neutral"}>{t(`pob.st.${r.status}`)}</StatusChip> },
          { key: "p", header: t("pob.progress"), cell: (r) => <span className="kx-label-num" data-testid={`pob-progress-${r.id}`}>{r.progress}%</span> },
          { key: "h", header: t("pob.humanNeeded"), cell: (r) => r.humanActions.length ? <Badge variant="warning" className="gap-1" data-testid="pob-human-flag"><Hand className="h-3 w-3" aria-hidden="true" />{r.humanActions.map((k) => t(`pob.step.${k}.title`)).join(" · ")}</Badge> : <span className="text-xs text-muted-foreground">-</span> },
          { key: "c", header: t("pob.created"), cell: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt, i18n.language)}</span> },
        ]} />
      )}
    </div>
  );
}
