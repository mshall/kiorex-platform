import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Hand } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { usePartnerConnections } from "@/api/partnerOnboarding";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatusChip, type Tone } from "@/components/kit";
import { EnrolmentCodesPanel } from "@/components/EnrolmentCodesPanel";
import { formatDateTime } from "@/lib/format";
import { useSiteLead, useSiteLeadSettings } from "@/api/siteLeads";
import { enrolKindForLead } from "@/lib/leadOnboarding";

export const PARTNER_TONE: Record<string, Tone> = { SUBMITTED: "info", IN_REVIEW: "info", CHANGES_REQUESTED: "warning", AWAITING_APPROVAL: "brand", APPROVED: "brand", LIVE: "success", PAUSED: "warning", REJECTED: "danger" };

/** Partner onboarding queue: standalone organisations asking to connect to the marketplace. The highlighted column is what a human still has to do. */
export default function PartnerOnboardingPage() {
  const { t, i18n } = useTranslation(); const nav = useNavigate(); const q = usePartnerConnections();
  const leadId = useSearchParams()[0].get("lead") ?? "";
  return (
    <div>
      <PageHeader title={t("pob.title")} hint={t("pob.hint")} />
      {leadId ? <FromLead leadId={leadId} /> : <EnrolmentCodesPanel />}
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

/** "Start onboarding" from a join request: the request is read with the user's own token (the URL carries only its id), shown as a banner, and the code form opens with the kind and label filled. Nothing is created until the user presses Create. */
function FromLead({ leadId }: { leadId: string }) {
  const { t, i18n } = useTranslation(); const lead = useSiteLead(leadId); const settings = useSiteLeadSettings();
  if (lead.isLoading) return <CardSkeleton rows={2} />;
  const d = lead.data; const cfg = settings.data?.config; const lang = i18n.language.startsWith("ar") ? "ar" : "en";
  if (!d) return <><p role="alert" className="mb-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="lead-onboarding-failed">{t("siteLeads.onboardingLoadFailed")}</p><EnrolmentCodesPanel /></>;
  const kind = enrolKindForLead(d.providerType); const typeLabel = cfg?.providerTypes.find((x) => x.key === d.providerType)?.[lang] ?? d.providerType;
  return (
    <>
      <section className="mb-4 rounded-2xl border border-primary/30 bg-primary/5 p-4" data-testid="lead-onboarding-banner" aria-labelledby="lead-onb-title">
        <h2 id="lead-onb-title" className="text-sm font-bold">{t("siteLeads.onboardingBanner", { ref: d.ref })}</h2>
        <p className="mt-1 text-sm" dir="auto">{t("siteLeads.onboardingBannerBody", { name: d.legalName, type: typeLabel, mode: t(`siteLeads.modeLong${d.mode}`) })}</p>
        {kind ? null : <p className="mt-1 text-xs text-muted-foreground">{t("siteLeads.onboardingKindOther")}</p>}
        <Link to={`/leads/${d.id}`} className="mt-2 inline-block text-sm font-medium underline">{t("siteLeads.onboardingBannerOpen")}</Link>
      </section>
      <EnrolmentCodesPanel key={d.id} prefill={{ kind, label: d.legalName }} />
    </>
  );
}
