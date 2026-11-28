import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueries } from "@tanstack/react-query";
import { rawApi } from "@/api/client";
import { Card, Figures, Rows, Shortcuts, arr, num, pending, useDash, when } from "@/components/dash/Dash";

const passportBase = (): string | null => { try { const a = (import.meta.env.VITE_OIDC_AUTHORITY as string | undefined) ?? ""; return a ? new URL(a).origin : null; } catch { return null; } };

type PolicyState = { counsel?: { history?: Array<{ status?: string }> }; disclosure?: { history?: Array<{ status?: string }> } };

/** super_admin: what is waiting for a decision across the maker-checker flows, audit highlights and the links to system health. */
export default function SuperAdminDashboard() {
  const { t, i18n } = useTranslation();
  const polMarkets = useDash<{ markets: string[] }>("pol-markets", "/admin/commissions/policy");
  const policies = useQueries({ queries: (polMarkets.data?.markets ?? []).map((m) => ({ queryKey: ["dash", "policy", m], queryFn: () => rawApi<PolicyState>("GET", `/admin/commissions/policy/${m}`), retry: false })) });
  const rates = useDash<Array<{ product: string; pending: unknown | null }>>("rates", "/admin/commissions/rates/defaults");
  const config = useDash<Array<{ status: string }>>("com-config", "/admin/commissions/config");
  const flags = useDash<Array<{ status?: string }>>("flag-requests", "/admin/flags/requests");
  const markets = useDash<{ items: Array<{ id: string; code: string }> }>("markets", "/admin/kiorly-markets");
  const changeReqs = useQueries({ queries: arr<{ id: string; code: string }>(markets.data).map((m) => ({ queryKey: ["dash", "mk-cr", m.id], queryFn: () => rawApi<unknown>("GET", `/admin/kiorly-markets/${encodeURIComponent(m.id)}/change-requests`), retry: false })) });
  const partners = useDash<Array<{ id: string; name: string; status: string }>>("partners", "/admin/onboarding/partners");
  const plans = useDash<{ pendingProposals?: unknown[] }>("plans", "/admin/kiorly-plans");
  const audit = useDash<Array<{ id: string; action: string; resource?: string; actor?: string; createdAt: string }>>("audit", "/admin/audit-log");
  const outbox = useDash<{ stats?: { dead: number; pending: number } }>("outbox", "/admin/outbox?status=DEAD");

  const comPol = policies.reduce((n, p) => n + [...(p.data?.counsel?.history ?? []), ...(p.data?.disclosure?.history ?? [])].filter((h) => pending(h.status)).length, 0);
  const comRates = arr<{ pending: unknown | null }>(rates.data).filter((r) => r.pending).length;
  const comCfg = arr<{ status: string }>(config.data).filter((c) => pending(c.status)).length;
  const flagReq = arr<{ status?: string }>(flags.data).filter((f) => pending(f.status ?? "PENDING")).length;
  const mkReq = changeReqs.reduce((n, c) => n + arr<{ status?: string }>(c.data).filter((x) => !x.status || pending(x.status)).length, 0);
  const partnerAwait = arr<{ id: string; name: string; status: string }>(partners.data).filter((p) => p.status === "AWAITING_APPROVAL");
  const planProps = Array.isArray(plans.data?.pendingProposals) ? plans.data!.pendingProposals!.length : null;
  const total = comPol + comRates + comCfg + flagReq + mkReq + partnerAwait.length + (planProps ?? 0);
  const base = passportBase();
  const rows = [
    { key: "pol", label: t("roleHome.approvals.commissionPolicy"), n: comPol, to: "/commission-policy", q: [polMarkets] },
    { key: "rates", label: t("roleHome.approvals.commissionRates"), n: comRates, to: "/commissions", q: [rates] },
    { key: "cfg", label: t("roleHome.approvals.commissionConfig"), n: comCfg, to: "/commissions", q: [config] },
    { key: "flags", label: t("roleHome.approvals.flags"), n: flagReq, to: "/flags", q: [flags] },
    { key: "markets", label: t("roleHome.approvals.markets"), n: mkReq, to: "/kiorly-markets", q: [markets] },
    { key: "partners", label: t("roleHome.approvals.partners"), n: partnerAwait.length, to: "/partner-onboarding", q: [partners] },
  ];
  const failed = rows.filter((r) => r.q.some((x) => x.error));
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="dashboard-super_admin">
      <Card id="approvals" title={t("roleHome.approvals.title")} hint={t("roleHome.approvals.hint")} className="lg:col-span-2">
        <Figures items={[{ label: t("roleHome.approvals.total"), value: num(total), tone: total > 0 ? "warn" : "ok", testid: "dash-approvals-total" }]} />
        <ul className="divide-y text-sm" data-testid="dash-approval-rows">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 py-1.5" data-testid={`dash-approval-${r.key}`}>
              <Link to={r.to} className="font-medium underline-offset-2 hover:underline">{r.label}</Link>
              <span className="kx-label-num text-sm">{r.q.some((x) => x.error) ? t("roleHome.unknown") : num(r.n)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 py-1.5" data-testid="dash-approval-plans">
            <Link to="/kiorly-plans" className="font-medium underline-offset-2 hover:underline">{t("roleHome.approvals.plans")}</Link>
            <span className="kx-label-num text-sm">{planProps === null ? t("roleHome.approvals.plansNoFeed") : num(planProps)}</span>
          </li>
          <li className="flex items-center justify-between gap-3 py-1.5" data-testid="dash-approval-passport">
            <span className="font-medium">{t("roleHome.approvals.passport")}</span>
            <span className="text-sm">{base ? <><a className="underline" href={`${base}/account/ops/mfa`}>{t("roleHome.approvals.mfa")}</a> · <a className="underline" href={`${base}/account/ops/limits`}>{t("roleHome.approvals.limits")}</a> · <a className="underline" href={`${base}/account/ops/kiorly-roles`}>{t("roleHome.approvals.kiorlyRoles")}</a></> : t("roleHome.approvals.passportNote")}</span>
          </li>
        </ul>
        {failed.length > 0 && <p role="alert" className="text-xs text-muted-foreground" data-testid="dash-approvals-partial">{t("roleHome.approvals.partial", { n: failed.length })}</p>}
      </Card>
      <Card id="audit" title={t("roleHome.audit.title")} hint={t("roleHome.audit.hint")} q={[audit]}>
        <Rows testid="dash-audit" empty={t("roleHome.audit.none")} rows={arr<{ id: string; action: string; resource?: string; createdAt: string }>(audit.data).slice(0, 8).map((a) => ({ key: a.id, primary: a.action, secondary: a.resource, end: when(a.createdAt, i18n.language) }))} />
      </Card>
      <Card id="health" title={t("roleHome.health.title")} hint={t("roleHome.health.hint")} q={[outbox]}>
        <Figures items={[{ label: t("roleHome.health.dead"), value: num(outbox.data?.stats?.dead ?? 0), tone: (outbox.data?.stats?.dead ?? 0) > 0 ? "danger" : "ok", testid: "dash-outbox-dead" }, { label: t("roleHome.health.pending"), value: num(outbox.data?.stats?.pending ?? 0) }]} />
        <Shortcuts items={[{ to: "/outbox", label: t("nav.outbox") }, { to: "/operations", label: t("nav.operations") }, { to: "/flags", label: t("nav.flags") }, { to: "/payments-connection", label: t("nav.payConn") }, { to: "/integrations", label: t("nav.integrationsCenter") }]} />
      </Card>
    </div>
  );
}
