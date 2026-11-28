import { useTranslation } from "react-i18next";
import { Card, Figures, Rows, Shortcuts, num, useDash } from "@/components/dash/Dash";
import type { Overview } from "@/api/growth";

/** growth_admin: growth engine KPIs from the same overview the Growth section uses. */
export default function GrowthDashboard() {
  const { t } = useTranslation();
  const o = useDash<Overview>("growth-overview", "/ops/growth/overview?market=EG&days=30");
  const decisions = o.data?.origins?.reduce((n, x) => n + x.count, 0) ?? 0;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="dashboard-growth_admin">
      <Card id="kpis" title={t("roleHome.growth.kpiTitle")} hint={t("roleHome.growth.kpiHint")} to="/growth" q={[o]}>
        <Figures items={[
          { label: t("roleHome.growth.decisions"), value: num(decisions), testid: "dash-decisions" },
          { label: t("roleHome.growth.providerLed"), value: o.data?.providerLedShare == null ? "-" : `${num(Math.round(o.data.providerLedShare * 100))}%` },
          { label: t("roleHome.growth.fraudOpen"), value: num(o.data?.fraudOpen ?? 0), tone: (o.data?.fraudOpen ?? 0) > 0 ? "warn" : "ok", testid: "dash-fraud-open" },
          { label: t("roleHome.growth.widgets"), value: num(o.data?.activeWidgets ?? 0) },
          { label: t("roleHome.growth.landing"), value: num(o.data?.landingPages?.indexable ?? 0) },
        ]} />
      </Card>
      <Card id="funnel" title={t("roleHome.growth.funnelTitle")} hint={t("roleHome.growth.funnelHint")} to="/growth/channels" q={[o]}>
        <Rows testid="dash-funnel" empty={t("roleHome.growth.noFunnel")} rows={(o.data?.funnel ?? []).map((f) => ({ key: f.name, primary: f.name, end: f.masked ? "<k" : num(f.count) }))} />
      </Card>
      <Card id="shortcuts" title={t("roleHome.shortcuts.title")} hint={t("roleHome.shortcuts.hintGrowth")} className="lg:col-span-2">
        <Shortcuts items={[{ to: "/growth", label: t("roleHome.growth.overview") }, { to: "/growth/channels", label: t("roleHome.growth.channels") }, { to: "/growth/fraud", label: t("roleHome.growth.fraud") }, { to: "/growth/seo", label: t("roleHome.growth.seo") }]} />
      </Card>
    </div>
  );
}
