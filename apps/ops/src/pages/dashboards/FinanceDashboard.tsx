import { useTranslation } from "react-i18next";
import { Card, Figures, Rows, Shortcuts, arr, num, useDash } from "@/components/dash/Dash";
import { formatMinor } from "@/lib/format";

/** finance: reconciliation, settlement and commission statements. Data is the commission console's own API (the finance role reads it) plus the payment matching queue. */
export default function FinanceDashboard() {
  const { t } = useTranslation();
  const summary = useDash<{ counts?: Record<string, number> }>("com-summary", "/admin/commissions/summary");
  const aging = useDash<{ buckets?: Record<string, number>; rows?: unknown[] }>("com-aging", "/admin/commissions/aging");
  const disputes = useDash<{ total?: number; items?: unknown[] } | unknown[]>("com-disputes", "/admin/commissions/disputes");
  const recon = useDash<unknown>("com-recon", "/admin/commissions/reconciliation");
  const runs = useDash<{ items?: Array<{ id: string; periodKey: string; status: string; mode: string; claimsMinor: number; currency: string; orgRef: string }> }>("com-runs", "/admin/commissions/runs");
  const matching = useDash<unknown[]>("matching", "/admin/payments/matching/queue");
  const counts = Object.entries(summary.data?.counts ?? {}).slice(0, 6);
  const findings = Array.isArray(recon.data) ? recon.data.length : arr(recon.data, "findings").length;
  const disputeTotal = Array.isArray(disputes.data) ? disputes.data.length : (disputes.data as { total?: number } | undefined)?.total ?? arr(disputes.data).length;
  const agingRows = arr(aging.data, "rows").length;
  const runRows = arr<{ id: string; periodKey: string; status: string; mode: string; claimsMinor: number; currency: string; orgRef: string }>(runs.data).slice(0, 5);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="dashboard-finance">
      <Card id="commissions" title={t("roleHome.finance.commissionsTitle")} hint={t("roleHome.finance.commissionsHint")} to="/commissions" q={[summary]}>
        <Figures items={counts.length ? counts.map(([k, v]) => ({ label: k, value: num(v) })) : [{ label: t("roleHome.finance.claims"), value: "0" }]} />
      </Card>
      <Card id="aging" title={t("roleHome.finance.agingTitle")} hint={t("roleHome.finance.agingHint")} to="/commissions" q={[aging, disputes]}>
        <Figures items={[{ label: t("roleHome.finance.openInvoices"), value: num(agingRows), tone: agingRows ? "warn" : "ok", testid: "dash-aging" }, { label: t("roleHome.finance.disputes"), value: num(disputeTotal), tone: disputeTotal ? "warn" : "ok", testid: "dash-disputes" }]} />
      </Card>
      <Card id="reconciliation" title={t("roleHome.finance.reconTitle")} hint={t("roleHome.finance.reconHint")} to="/commissions" q={[recon, matching]}>
        <Figures items={[{ label: t("roleHome.finance.findings"), value: num(findings), tone: findings ? "danger" : "ok", testid: "dash-findings" }, { label: t("roleHome.finance.matching"), value: num(arr(matching.data).length), tone: arr(matching.data).length ? "warn" : undefined, testid: "dash-matching" }]} />
      </Card>
      <Card id="runs" title={t("roleHome.finance.runsTitle")} hint={t("roleHome.finance.runsHint")} to="/commissions" q={[runs]}>
        <Rows testid="dash-runs" empty={t("roleHome.finance.noRuns")} rows={runRows.map((r) => ({ key: r.id, primary: `${r.periodKey} · ${r.orgRef}`, secondary: `${r.status} · ${r.mode}`, end: formatMinor(r.claimsMinor, "en", r.currency) }))} />
      </Card>
      <Card id="shortcuts" title={t("roleHome.shortcuts.title")} hint={t("roleHome.shortcuts.hintFinance")} className="lg:col-span-2">
        <Shortcuts items={[{ to: "/commissions", label: t("nav.commissions") }, { to: "/commission-policy", label: t("roleHome.finance.statements") }, { to: "/pay-ops", label: t("nav.payOps") }, { to: "/growth/finance", label: t("roleHome.finance.growthFinance") }]} />
      </Card>
    </div>
  );
}
