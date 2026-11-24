import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useGrowthAccess, useWidgets, useWidgetStatus } from "@/api/growth";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { ConfigPanel, PayloadSummary } from "@/components/growth/ConfigPanel";
import { GrowthPage, MarketSelect, Section, useGrowthMarket } from "@/components/growth/GrowthPage";
import { formatDateTime } from "@/lib/format";

export default function GrowthWidgetsPage() {
  const { t, i18n } = useTranslation(); const g = useGrowthMarket();
  const q = useWidgets(g.market); const set = useWidgetStatus(); const can = useGrowthAccess().data?.capabilities.manage;
  const flip = (orgRef: string, status: "ACTIVE" | "DISABLED") => set.mutate({ orgRef, status }, { onSuccess: () => toast.success(t("growth.widgets.saved")), onError: (e) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle")) });
  return (
    <GrowthPage section="widgets" toolbar={<MarketSelect g={g} />}>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <>
          <Section title={t("growth.widgets.registrations")} id="wg-reg" hint={t("growth.widgets.registrationsHint")}>
            <DataTable caption={t("growth.widgets.registrations")} rows={q.data.registrations} rowKey={(r) => r.id} empty={t("growth.widgets.empty")} columns={[
              { key: "o", header: t("growth.widgets.org"), cell: (r) => <div><code className="text-xs">{r.orgRef}</code>{r.orgSlug && <div className="text-xs text-muted-foreground">{r.orgSlug}</div>}</div> },
              { key: "or", header: t("growth.widgets.origins"), cell: (r) => <ul className="space-y-0.5" dir="ltr">{r.origins.map((o) => <li key={o}><code className="text-xs">{o}</code></li>)}{r.origins.length === 0 && <li className="text-xs text-muted-foreground">—</li>}</ul> },
              { key: "s", header: t("growth.widgets.state"), cell: (r) => <StatusChip tone={r.status === "ACTIVE" ? "success" : "neutral"}>{t(`growth.widgets.status.${r.status}`)}</StatusChip> },
              { key: "y", header: t("growth.widgets.synced"), cell: (r) => <span className="text-xs">{formatDateTime(r.syncedAt, i18n.language)}</span> },
              { key: "a", header: t("growth.common.actions"), cell: (r) => can ? <Button size="sm" variant="outline" disabled={set.isPending} onClick={() => flip(r.orgRef, r.status === "ACTIVE" ? "DISABLED" : "ACTIVE")} data-testid={`widget-toggle-${r.orgRef}`}>{r.status === "ACTIVE" ? t("growth.widgets.disable") : t("growth.widgets.enable")}</Button> : null },
            ]} />
          </Section>
          <Section title={t("growth.widgets.policy")} id="wg-policy" hint={t("growth.widgets.policyHint")}><PayloadSummary payload={q.data.policy.payload} /></Section>
          <Section title={t("growth.widgets.audit")} id="wg-audit">
            <DataTable caption={t("growth.widgets.audit")} rows={q.data.audit} rowKey={(r) => r.id} empty={t("growth.common.noData")} columns={[
              { key: "at", header: t("growth.audit.when"), cell: (r) => <span className="text-xs">{formatDateTime(r.createdAt, i18n.language)}</span> }, { key: "a", header: t("growth.audit.actor"), cell: (r) => r.actor },
              { key: "ac", header: t("growth.audit.action"), cell: (r) => <code className="text-xs">{r.action}</code> }, { key: "r", header: t("growth.audit.resourceId"), cell: (r) => <code className="text-xs">{r.resourceId ?? "—"}</code> },
            ]} />
          </Section>
        </>)}
      <ConfigPanel kind="WIDGET_POLICY" market={g.market} showScopePicker={g.show} />
    </GrowthPage>
  );
}
