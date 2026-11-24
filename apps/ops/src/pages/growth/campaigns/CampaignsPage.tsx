import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useCampaigns, type CampaignBrief, type CampaignStatus } from "@/api/campaigns";
import { useGrowthAccess } from "@/api/growth";
import { DataTable, type Column } from "@/components/DataTable";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/states";
import { GrowthPage, selectCls } from "@/components/growth/GrowthPage";
import { BudgetMeter, CampaignStatusChip, useMoney } from "@/components/growth/campaign-parts";
import { formatDateTime } from "@/lib/format";

/** The campaign list. `promotional` shows only campaigns whose objective is Promotion (the Promotional Campaigns page). */
export default function CampaignsPage({ promotional = false }: { promotional?: boolean }) {
  const { t, i18n } = useTranslation(); const nav = useNavigate(); const money = useMoney();
  const [status, setStatus] = useState(""); const [q, setQ] = useState("");
  const list = useCampaigns({ status: status || undefined, q: q || undefined, promotional }); const access = useGrowthAccess(); const can = !!access.data?.capabilities.manageCampaigns;
  const cols: Column<CampaignBrief>[] = [
    { key: "name", header: t("growth.campaigns.list.colName"), cell: (c) => <div><Link className="font-semibold text-primary hover:underline" to={`/growth/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.name}</Link><div className="text-xs text-muted-foreground"><code dir="ltr">{c.utmCampaign}</code> · {t(`growth.campaigns.objective.${c.objective}`, { defaultValue: c.objective })}</div></div> },
    { key: "status", header: t("growth.campaigns.list.colStatus"), cell: (c) => <CampaignStatusChip status={c.status} /> },
    { key: "budget", header: t("growth.campaigns.list.colBudget"), cell: (c) => <div className="min-w-[10rem]"><div className="tabular-nums">{money(c.budgetTotalMinor, c.currency)}</div><BudgetMeter bp={c.utilisationBp ?? 0} label={t("growth.campaigns.list.colSpent")} /></div> },
    { key: "window", header: t("growth.campaigns.list.colWindow"), cell: (c) => <span className="text-xs">{c.startsAt ? formatDateTime(c.startsAt, i18n.language) : "-"}<br />{c.endsAt ? formatDateTime(c.endsAt, i18n.language) : "-"}</span> },
    { key: "channels", header: t("growth.campaigns.list.colChannels"), cell: (c) => <span className="text-xs">{c.channels.map((x) => t(`growth.campaigns.channel.${x}`, { defaultValue: x })).join(", ")}</span> },
  ];
  const newTo = promotional ? "/growth/campaigns/new?objective=PROMOTION" : "/growth/campaigns/new";
  return (
    <GrowthPage section={promotional ? "promotions" : "campaigns"}
      actions={can ? <Link to={newTo} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90" data-testid="campaign-new"><Plus className="h-4 w-4" aria-hidden="true" />{promotional ? t("growth.campaigns.list.newPromo") : t("growth.campaigns.list.new")}</Link> : null}
      toolbar={<>
        <label className="flex items-center gap-2 text-sm"><span className="sr-only">{t("growth.campaigns.list.search")}</span><input type="search" className="h-11 w-56 rounded-xl border border-input bg-card px-3 text-sm" placeholder={t("growth.campaigns.list.search")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="campaign-search" /></label>
        <label className="flex items-center gap-2 text-sm"><span className="sr-only">{t("growth.campaigns.list.colStatus")}</span><select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="campaign-status-filter"><option value="">{t("growth.campaigns.list.allStatuses")}</option>{(["DRAFT", "PENDING_APPROVAL", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] as CampaignStatus[]).map((s) => <option key={s} value={s}>{t(`growth.campaigns.status.${s}`)}</option>)}</select></label>
      </>}>
      <p className="rounded-xl bg-info-soft p-3 text-sm text-info" data-testid="campaigns-plans-only">{promotional ? t("growth.campaigns.promo.banner") : t("growth.campaigns.list.plansOnly")}</p>
      {!can && !access.isLoading && <p className="text-xs text-muted-foreground" data-testid="campaigns-readonly">{t("growth.campaigns.list.readOnly")}</p>}
      {list.isLoading ? <CardSkeleton rows={3} /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : (
        <DataTable columns={cols} rows={list.data ?? []} rowKey={(c) => c.id} caption={t("growth.sections.campaigns.title")} onRowClick={(c) => nav(`/growth/campaigns/${c.id}`)}
          empty={<EmptyState title={t("growth.campaigns.list.empty")} hint={t("growth.campaigns.list.emptyHint")} />} />)}
    </GrowthPage>
  );
}
