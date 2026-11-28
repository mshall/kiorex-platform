import { useTranslation } from "react-i18next";
import { Card, Figures, Rows, Shortcuts, arr, num, useDash } from "@/components/dash/Dash";
import { ImportDraftsCard, JoinRequestsCard, PartnerQueueCard } from "./shared";

interface Plans { clinic?: { available?: boolean; plans?: Array<{ id: string; isPublic: boolean }> }; content?: { config?: { pharmacy?: { plans?: Array<{ visible: boolean }> }; lab?: { plans?: Array<{ visible: boolean }> } } }; pendingProposals?: unknown[] }
interface MarketRow { id: string; code: string; nameEn: string; status: string; operability: string }

/** kiorly_ops and kiorly_admin: the Kiorly work only. No patient identifiers anywhere on this page; nothing here is Kiorex-only data. */
export default function KiorlyDashboard({ admin }: { admin: boolean }) {
  const { t } = useTranslation();
  const plans = useDash<Plans>("plans", "/admin/kiorly-plans");
  const markets = useDash<{ items: MarketRow[] } | MarketRow[]>("markets", "/admin/kiorly-markets");
  const polMarkets = useDash<{ markets: string[] }>("pol-markets", "/admin/commissions/policy");
  const first = polMarkets.data?.markets?.[0];
  const policy = useDash<{ paymentMode?: string; counsel?: { record?: { status?: string } | null } }>("policy", `/admin/commissions/policy/${first ?? ""}`, !!first);
  const partnerLeads = useDash<{ count: number }>("partner-leads", "/admin/partner-leads/unread");
  const verif = useDash<Array<{ ref?: string; id?: string; status?: string }>>("verif", "/admin/onboarding/verification-updates");
  const mk = arr<MarketRow>(markets.data);
  const openVerif = arr<{ status?: string }>(verif.data).filter((v) => !/APPROVED|REJECTED|DECIDED|CLOSED/i.test(String(v.status ?? ""))).length;
  const planCount = (plans.data?.clinic?.plans ?? []).filter((p) => p.isPublic).length + (plans.data?.content?.config?.pharmacy?.plans ?? []).filter((p) => p.visible).length + (plans.data?.content?.config?.lab?.plans ?? []).filter((p) => p.visible).length;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid={admin ? "dashboard-kiorly_admin" : "dashboard-kiorly_ops"}>
      <JoinRequestsCard />
      <PartnerQueueCard />
      <ImportDraftsCard />
      <Card id="partner-leads" title={t("roleHome.partnerLeads.title")} hint={t("roleHome.partnerLeads.hint")} to="/partner-leads" q={[partnerLeads, verif]}>
        <Figures items={[{ label: t("roleHome.partnerLeads.unread"), value: num(partnerLeads.data?.count ?? 0), tone: (partnerLeads.data?.count ?? 0) > 0 ? "warn" : undefined, testid: "dash-partner-leads" }, { label: t("roleHome.verif.open"), value: num(openVerif), testid: "dash-verif-open" }]} />
      </Card>
      <Card id="plans" title={t("roleHome.plans.title")} hint={t("roleHome.plans.hint")} to="/kiorly-plans" q={[plans]}>
        <Figures items={[{ label: t("roleHome.plans.visible"), value: num(planCount), testid: "dash-plans-visible" }, { label: t("roleHome.plans.proposals"), value: Array.isArray(plans.data?.pendingProposals) ? num(plans.data!.pendingProposals!.length) : "-", testid: "dash-plans-proposals" }]} />
        <p className="text-xs text-muted-foreground">{Array.isArray(plans.data?.pendingProposals) ? t("roleHome.plans.proposalsHint") : t("roleHome.plans.noProposalFeed")}</p>
      </Card>
      <Card id="markets" title={t("roleHome.markets.title")} hint={t("roleHome.markets.hint")} to="/kiorly-markets" q={[markets]}>
        <Rows testid="dash-markets" empty={t("roleHome.markets.none")} rows={mk.map((m) => ({ key: m.id, primary: `${m.nameEn} (${m.code})`, secondary: m.operability, end: m.status }))} />
        <p className="text-xs text-muted-foreground">{t("roleHome.markets.readOnly")}</p>
      </Card>
      <Card id="policy" title={t("roleHome.policy.title")} hint={t("roleHome.policy.hint")} to="/commission-policy" q={first ? [polMarkets, policy] : [polMarkets]}>
        <Figures items={[{ label: t("roleHome.policy.mode"), value: policy.data?.paymentMode ?? "-", testid: "dash-policy-mode" }, { label: t("roleHome.policy.counsel"), value: policy.data?.counsel?.record?.status ?? t("roleHome.policy.notReviewed") }]} />
        <p className="text-xs text-muted-foreground">{t("roleHome.policy.readOnly")}</p>
      </Card>
      {admin && (
        <Card id="shortcuts" title={t("roleHome.shortcuts.title")} hint={t("roleHome.shortcuts.hintAdmin")} className="lg:col-span-2">
          <Shortcuts items={[{ to: "/leads", label: t("roleHome.shortcuts.assign") }, { to: "/partner-onboarding", label: t("roleHome.shortcuts.enrol") }, { to: "/onboarding", label: t("roleHome.shortcuts.imports") }, { to: "/partner-leads", label: t("roleHome.shortcuts.partnerLeads") }, { to: "/kiorly-plans", label: t("roleHome.shortcuts.plans") }]} />
        </Card>
      )}
    </div>
  );
}
