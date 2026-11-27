/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed response captures and render callbacks over the ops wire shape */
import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Play, RefreshCw } from "lucide-react";
import { rawApi, rawBlob, rawText } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatMinor } from "@/lib/format";
import { OrgRatePanel, RatesTab } from "./commission-rates";

type Page<T> = { total: number; items: T[] };
type Caps = { read: boolean; export: boolean; operate: boolean; proposeConfig: boolean; approveConfig: boolean; chooseProvider: boolean; proposeRate?: boolean; approveRate?: boolean };
interface Claim { id: string; orgRef: string; chargeId: string; appointmentId: string; amountMinor: number; decisionAmountMinor: number | null; feeBasisMinor: number | null; sponsoredDiscountMinor: number | null; basisPolicyVersion: string | null; policyVersion: string | null; currency: string; chargeStatus: string; disputeStatus: string | null; collectionStatus: string; collectedMinor: number; reversedAfterCollection: boolean; runId: string | null; tender?: string | null; tenderMethod?: string | null; tenderDetail?: string | null }
interface Run { id: string; orgRef: string; periodKey: string; status: string; mode: string; modeRequested: string | null; fallbackReason: string | null; provider: string | null; currency: string; claimsCount: number; claimsMinor: number; collectedMinor: number; deductedMinor: number; invoicedMinor: number; paidMinor: number; invoiceNo: string | null }
interface Attempt { id: string; attemptNo: number; kind: string; status: string; amountMinor: number; failureCode: string | null; providerRef: string | null; payoutRef: string | null }
interface Tl { id: string; at: string; event: string; actor: string; detail: unknown }
interface Finding { code: string; orgRef: string; ref?: string; expectedMinor: number; actualMinor: number; message: string }
interface Summary { figures: Record<string, number>; counts: Record<string, number> }
interface Aging { buckets: Record<string, number>; rows: Array<{ runId: string; orgRef: string; periodKey: string; status: string; bucket: string; openMinor: number; currency: string; dueAt: string; invoiceNo: string | null }> }
interface Org { orgRef: string; market: string; currency: string; claims: number; claimsMinor: number; collectedMinor: number; provider: string | null; openRuns: number }
interface Policy { id: string; scope: string; scopeRef: string; version: number; status: string; settings: Record<string, unknown>; proposedBy: string }
interface OrgDetail { config: { settings: Record<string, unknown>; missing: string[] }; provider: string | null; providersAvailable: string[] }

const TABS = ["overview", "ledger", "collections", "payouts", "aging", "disputes", "recon", "orgs", "rates", "config"] as const;
type Tab = (typeof TABS)[number];
const B = "/admin/commissions";

/** COM-1 platform finance console: commissions ledger, collections, payout deductions, aging, disputes, reconciliation, per-organisation drill-down, configuration, audited CSV exports. Money views need the finance or super_admin role (the API enforces it too). */
export default function CommissionsPage() {
  const { t, i18n } = useTranslation(); const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview"); const [org, setOrg] = useState<string | null>(null); const [run, setRun] = useState<string | null>(null);
  const caps = useQuery({ queryKey: ["com", "caps"], queryFn: () => rawApi<Caps>("GET", `${B}/capabilities`) });
  const m = (n: number, cur = "EGP") => <span className="kx-label-num" dir="ltr">{formatMinor(n, i18n.language, cur)}</span>;
  const st = (s: string) => <Badge variant={["COLLECTED", "SETTLED", "PAID", "ACTIVE", "CONFIRMED"].includes(s) ? "success" : ["RETRYING", "INVOICE_OPEN", "DISPUTED", "OPEN", "PENDING"].includes(s) ? "warning" : "secondary"}>{t(`commissions.status.${s}`, { defaultValue: s })}</Badge>;
  const qs = org ? `?org=${encodeURIComponent(org)}` : "";
  const exp = async (view: string) => { const csv = await rawText(`${B}/export/${view}${qs}`); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `commission-${view}.csv`; a.click(); };
  const pdf = async () => { try { const b = await rawBlob(`${B}/statement.pdf${qs}`); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "commission-statement.pdf"; a.click(); } catch { toast.error(t("commissions.toast.error")); } };
  const trigger = useMutation({ mutationFn: () => rawApi("POST", `${B}/runs/trigger`, org ? { orgRef: org } : {}), onSuccess: () => { toast.success(t("commissions.toast.ran")); void qc.invalidateQueries({ queryKey: ["com"] }); }, onError: () => toast.error(t("commissions.toast.error")) });
  const retry = useMutation({ mutationFn: (id: string) => rawApi("POST", `${B}/runs/${id}/retry`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["com"] }), onError: () => toast.error(t("commissions.toast.error")) });

  if (caps.isLoading) return <CardSkeleton rows={3} />;
  if (caps.error) return <ErrorState error={caps.error} onRetry={() => void caps.refetch()} />;
  if (!caps.data?.read) return <div role="alert" className="mx-auto mt-16 max-w-md text-center" data-testid="com-no-access"><h1 className="text-xl">{t("commissions.title")}</h1><p className="mt-2 text-muted-foreground">{t("commissions.noAccess")}</p></div>;

  const view = (key: string, path: string, render: (d: any) => ReactElement) => <Q k={key} path={`${path}`} render={render} />;
  // LG-COM-20: a cash transfer is cash-type but shown as its own kind; a claim whose tender was not reported reads "Not reported" (never guessed)
  const tenderLabel = (r: Claim) => (r.tender === "ONLINE" ? t("commissions.tender.ONLINE") : r.tender === "CASH" ? (r.tenderMethod === "CASH_TRANSFER" ? <>{t("commissions.tender.CASH_TRANSFER")}{r.tenderDetail ? <span className="text-xs text-muted-foreground"> ({t(`commissions.tender.detail.${r.tenderDetail}`, { defaultValue: r.tenderDetail })})</span> : null}</> : t("commissions.tender.CASH")) : t("commissions.tender.NONE"));
  const claimCols = (rows: Claim[]) => <DataTable caption={t("commissions.tabs.ledger")} rows={rows} rowKey={(r) => r.id} empty={t("commissions.empty")} columns={[
    { key: "o", header: t("commissions.col.org"), cell: (r) => <button className="underline" onClick={() => setOrg(r.orgRef)}>{r.orgRef}</button> },
    { key: "c", header: t("commissions.col.charge"), cell: (r) => <code dir="ltr" className="text-xs">{r.chargeId}</code> },
    { key: "a", header: t("commissions.col.amount"), cell: (r) => m(r.amountMinor, r.currency) },
    { key: "d", header: t("commissions.col.decision"), cell: (r) => (r.decisionAmountMinor === null ? "-" : m(r.decisionAmountMinor, r.currency)) },
    { key: "b", header: t("commissions.col.basis"), cell: (r) => (r.feeBasisMinor === null ? "-" : <>{m(r.feeBasisMinor, r.currency)} <span className="text-xs text-muted-foreground">({r.basisPolicyVersion})</span></>) },
    { key: "s", header: t("commissions.col.sponsored"), cell: (r) => (r.sponsoredDiscountMinor === null ? "-" : m(r.sponsoredDiscountMinor, r.currency)) },
    { key: "p", header: t("commissions.col.policy"), cell: (r) => <span className="text-xs" dir="ltr">{r.policyVersion ?? "-"}</span> },
    { key: "td", header: t("commissions.col.tender"), cell: (r) => <span data-testid="com-claim-tender">{tenderLabel(r)}</span> },
    { key: "st", header: t("commissions.col.status"), cell: (r) => st(r.chargeStatus) },
    { key: "co", header: t("commissions.col.collection"), cell: (r) => <>{st(r.collectionStatus)}{r.reversedAfterCollection && <Badge variant="destructive" className="ms-1">{t("commissions.cards.creditDue")}</Badge>}</> },
    { key: "r", header: "", cell: (r) => (r.runId ? <Button size="sm" variant="outline" onClick={() => setRun(r.runId)}>{t("commissions.actions.drill")}</Button> : null) },
  ]} />;

  return (
    <div>
      <PageHeader title={t("commissions.title")} hint={t("commissions.hint")} actions={<>
        {org && <Button variant="outline" onClick={() => setOrg(null)} data-testid="com-clear-org">{org} ×</Button>}
        {caps.data.export && <Button variant="outline" onClick={() => void pdf()} data-testid="com-pdf"><Download aria-hidden="true" className="me-1.5 h-4 w-4" />{t("commissions.actions.pdf")}</Button>}
        {caps.data.operate && <Button onClick={() => trigger.mutate()} disabled={trigger.isPending} data-testid="com-run"><Play aria-hidden="true" className="me-1.5 h-4 w-4" />{t("commissions.actions.runDue")}</Button>}
      </>} />
      <div role="tablist" aria-label={t("commissions.title")} className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((x) => <button key={x} role="tab" aria-selected={tab === x} data-testid={`com-tab-${x}`} onClick={() => { setTab(x); setRun(null); }} className={`h-11 rounded-xl border px-3.5 text-sm ${tab === x ? "bg-primary text-primary-foreground" : "bg-card"}`}>{t(`commissions.tabs.${x}`)}</button>)}
      </div>
      {run && <RunDrill id={run} onClose={() => setRun(null)} canRetry={caps.data.operate} onRetry={(id) => retry.mutate(id)} m={m} st={st} />}
      {tab === "overview" && view(`sum${qs}`, `${B}/summary${qs}`, (d: Summary) => (
        <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="com-cards">
          {([["collected", d.figures.collectedMinor], ["deducted", d.figures.deductedMinor], ["invoiceOpen", d.figures.invoiceOpenMinor], ["overdue", d.figures.overdueMinor], ["disputedOpen", d.figures.disputedOpenMinor], ["creditDue", d.figures.creditDueMinor]] as const).map(([k, v]) => <div key={k} className="rounded-xl border bg-card p-4 shadow-card"><div className="text-xs text-muted-foreground">{t(`commissions.cards.${k}`)}</div><div className="mt-1 text-xl font-semibold" data-testid={`com-card-${k}`}>{m(v ?? 0)}</div></div>)}
        </div>
        {/* LG-COM-20: exceptions and kinds of tender, counts of live claims */}
        <dl className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="com-tender-counts">
          <div className="rounded-xl border bg-card p-4 shadow-card"><dt className="text-xs text-muted-foreground">{t("commissions.cards.cashTransfer")}</dt><dd className="mt-1 text-xl font-semibold" data-testid="com-card-cashTransfer">{d.counts.cashTransfer ?? 0}</dd></div>
          <div className="rounded-xl border bg-card p-4 shadow-card"><dt className="text-xs text-muted-foreground">{t("commissions.cards.unknownTender")}</dt><dd className="mt-1 flex items-center gap-2 text-xl font-semibold" data-testid="com-card-unknownTender">{d.counts.unknownTender ?? 0}{(d.counts.unknownTender ?? 0) > 0 && <Badge variant="warning">{t("commissions.cards.exception")}</Badge>}</dd><dd className="mt-1 text-xs text-muted-foreground">{t("commissions.cards.unknownTenderHint")}</dd></div>
        </dl></>))}
      {tab === "ledger" && <><ExportBtn onClick={() => void exp("claims")} label={t("commissions.actions.export")} disabled={!caps.data.export} />{view(`claims${qs}`, `${B}/claims${qs}`, (d: Page<Claim>) => claimCols(d.items))}</>}
      {tab === "collections" && <><ExportBtn onClick={() => void exp("runs")} label={t("commissions.actions.export")} disabled={!caps.data.export} />{view(`runs${qs}`, `${B}/runs${qs}`, (d: Page<Run>) => (
        <DataTable caption={t("commissions.tabs.collections")} rows={d.items} rowKey={(r) => r.id} empty={t("commissions.empty")} onRowClick={(r) => setRun(r.id)} columns={[
          { key: "o", header: t("commissions.col.org"), cell: (r) => r.orgRef }, { key: "p", header: t("commissions.col.period"), cell: (r) => <span dir="ltr">{r.periodKey}</span> },
          { key: "s", header: t("commissions.col.status"), cell: (r) => st(r.status) }, { key: "m", header: t("commissions.col.mode"), cell: (r) => t(`commissions.modes.${r.mode}`, { defaultValue: r.mode }) },
          { key: "pr", header: t("commissions.col.provider"), cell: (r) => r.provider ?? "-" }, { key: "a", header: t("commissions.col.amount"), cell: (r) => m(r.claimsMinor, r.currency) },
          { key: "c", header: t("commissions.col.collected"), cell: (r) => m(r.collectedMinor, r.currency) }, { key: "d", header: t("commissions.col.deducted"), cell: (r) => m(r.deductedMinor, r.currency) }, { key: "i", header: t("commissions.col.invoiced"), cell: (r) => m(r.invoicedMinor, r.currency) },
        ]} />))}</>}
      {tab === "payouts" && <><ExportBtn onClick={() => void exp("deductions")} label={t("commissions.actions.export")} disabled={!caps.data.export} />{view(`ded${qs}`, `${B}/deductions${qs}`, (d: Page<{ id: string; payoutRef: string; clinicId: string; grossMinor: number; amountMinor: number; commissionDeductedMinor: number; currency: string }>) => (
        <DataTable caption={t("commissions.tabs.payouts")} rows={d.items} rowKey={(r) => r.id} empty={t("commissions.empty")} columns={[
          { key: "p", header: t("commissions.col.payout"), cell: (r) => <code dir="ltr" className="text-xs">{r.payoutRef}</code> }, { key: "g", header: t("commissions.col.gross"), cell: (r) => m(r.grossMinor, r.currency) },
          { key: "d", header: t("commissions.col.deducted"), cell: (r) => m(r.commissionDeductedMinor, r.currency) }, { key: "c", header: t("commissions.col.cash"), cell: (r) => m(r.amountMinor, r.currency) },
        ]} />))}</>}
      {tab === "aging" && <><ExportBtn onClick={() => void exp("aging")} label={t("commissions.actions.export")} disabled={!caps.data.export} />{view(`aging${qs}`, `${B}/aging${qs}`, (d: Aging) => (<>
        <div className="mb-3 grid gap-2 sm:grid-cols-5" data-testid="com-buckets">{Object.entries(d.buckets).map(([k, v]) => <div key={k} className="rounded-xl border bg-card p-3"><div className="text-xs text-muted-foreground">{t(`commissions.buckets.${k}`)}</div><div className="font-semibold">{m(v)}</div></div>)}</div>
        <DataTable caption={t("commissions.tabs.aging")} rows={d.rows} rowKey={(r) => r.runId} empty={t("commissions.empty")} onRowClick={(r) => setRun(r.runId)} columns={[
          { key: "o", header: t("commissions.col.org"), cell: (r) => r.orgRef }, { key: "p", header: t("commissions.col.period"), cell: (r) => <span dir="ltr">{r.periodKey}</span> }, { key: "s", header: t("commissions.col.status"), cell: (r) => st(r.status) },
          { key: "b", header: t("commissions.col.bucket"), cell: (r) => t(`commissions.buckets.${r.bucket}`) }, { key: "m", header: t("commissions.col.open"), cell: (r) => m(r.openMinor, r.currency) }, { key: "d", header: t("commissions.col.due"), cell: (r) => formatDateTime(r.dueAt, i18n.language) },
        ]} /></>))}</>}
      {tab === "disputes" && <><ExportBtn onClick={() => void exp("disputes")} label={t("commissions.actions.export")} disabled={!caps.data.export} />{view(`dis${qs}`, `${B}/disputes${qs}`, (d: Page<Claim>) => claimCols(d.items))}</>}
      {tab === "recon" && <><ExportBtn onClick={() => void exp("reconciliation")} label={t("commissions.actions.export")} disabled={!caps.data.export} />{view(`rec${qs}`, `${B}/reconciliation${qs}`, (d: { findings: Finding[] }) => d.findings.length === 0 ? <p className="rounded-xl border bg-card p-4" data-testid="com-recon-clean">{t("commissions.recon.clean")}</p> : (
        <DataTable caption={t("commissions.tabs.recon")} rows={d.findings} rowKey={(f) => `${f.code}:${f.ref}`} empty={t("commissions.empty")} columns={[
          { key: "c", header: t("commissions.col.code"), cell: (f) => <Badge variant="warning">{f.code}</Badge> }, { key: "o", header: t("commissions.col.org"), cell: (f) => f.orgRef }, { key: "e", header: t("commissions.col.expected"), cell: (f) => m(f.expectedMinor) }, { key: "a", header: t("commissions.col.actual"), cell: (f) => m(f.actualMinor) }, { key: "m", header: t("commissions.col.message"), cell: (f) => f.message },
        ]} />))}</>}
      {tab === "orgs" && view("orgs", `${B}/orgs`, (d: Org[]) => (
        <DataTable caption={t("commissions.tabs.orgs")} rows={d} rowKey={(r) => r.orgRef} empty={t("commissions.empty")} onRowClick={(r) => { setOrg(r.orgRef); setTab("overview"); }} columns={[
          { key: "o", header: t("commissions.col.org"), cell: (r) => r.orgRef }, { key: "p", header: t("commissions.col.provider"), cell: (r) => r.provider ?? "-" }, { key: "c", header: t("commissions.col.claims"), cell: (r) => r.claims },
          { key: "a", header: t("commissions.col.amount"), cell: (r) => m(r.claimsMinor, r.currency) }, { key: "d", header: t("commissions.col.collected"), cell: (r) => m(r.collectedMinor, r.currency) },
        ]} />))}
      {tab === "rates" && <RatesTab caps={caps.data} />}
      {tab === "config" && <Config org={org} />}
      {org && (tab === "overview" || tab === "rates") && <OrgPanel org={org} />}
      {org && (tab === "overview" || tab === "rates") && <OrgRatePanel org={org} caps={caps.data} />}
    </div>
  );
}

function ExportBtn({ onClick, label, disabled }: { onClick: () => void; label: string; disabled: boolean }) { return <div className="mb-3"><Button variant="outline" size="sm" onClick={onClick} disabled={disabled} data-testid="com-export"><Download aria-hidden="true" className="me-1.5 h-4 w-4" />{label}</Button></div>; }

function Q({ k, path, render }: { k: string; path: string; render: (d: any) => ReactElement }) {
  const q = useQuery({ queryKey: ["com", k], queryFn: () => rawApi<unknown>("GET", path) });
  if (q.isLoading) return <CardSkeleton rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return render(q.data);
}

function RunDrill({ id, onClose, canRetry, onRetry, m, st }: { id: string; onClose: () => void; canRetry: boolean; onRetry: (id: string) => void; m: (n: number, c?: string) => ReactElement; st: (s: string) => ReactElement }) {
  const { t, i18n } = useTranslation();
  const q = useQuery({ queryKey: ["com", "run", id], queryFn: () => rawApi<{ run: Run; claims: Claim[]; attempts: Attempt[]; timeline: Tl[]; findings: Finding[] }>("GET", `${B}/runs/${id}`) });
  if (q.isLoading) return <CardSkeleton rows={2} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { run, claims, attempts, timeline, findings } = q.data;
  return (
    <section aria-label={t("commissions.actions.drill")} className="mb-6 rounded-xl border bg-card p-4 shadow-card" data-testid="com-run-drill">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">{run.orgRef} <span dir="ltr">{run.periodKey}</span> {st(run.status)}</h2>
        <div className="flex gap-2">{canRetry && run.status === "RETRYING" && <Button size="sm" onClick={() => onRetry(id)}><RefreshCw aria-hidden="true" className="me-1.5 h-4 w-4" />{t("commissions.actions.retry")}</Button>}<Button size="sm" variant="outline" onClick={onClose}>{t("commissions.actions.close")}</Button></div></div>
      <p className="mt-1 text-sm text-muted-foreground">{t(`commissions.modes.${run.mode}`, { defaultValue: run.mode })}{run.fallbackReason ? ` · ${t("commissions.col.fallback")}: ${run.fallbackReason}` : ""} · {m(run.claimsMinor, run.currency)} = {m(run.collectedMinor, run.currency)} + {m(run.deductedMinor, run.currency)} + {m(run.invoicedMinor, run.currency)}</p>
      <h3 className="mb-1 mt-3 text-sm font-semibold">{t("commissions.drill.findings")}</h3>
      {findings.length === 0 ? <p className="text-sm" data-testid="com-run-clean">{t("commissions.drill.clean")}</p> : <ul className="text-sm">{findings.map((f) => <li key={`${f.code}${f.ref}`}><Badge variant="warning">{f.code}</Badge> {f.message}</li>)}</ul>}
      <h3 className="mb-1 mt-3 text-sm font-semibold">{t("commissions.drill.claims")} ({claims.length})</h3>
      <ul className="text-sm">{claims.map((c) => <li key={c.id}><code dir="ltr">{c.chargeId}</code> {m(c.amountMinor, c.currency)} {st(c.collectionStatus)}</li>)}</ul>
      <h3 className="mb-1 mt-3 text-sm font-semibold">{t("commissions.drill.attempts")}</h3>
      <ul className="text-sm">{attempts.map((a) => <li key={a.id}>#{a.attemptNo} {a.kind} {st(a.status === "SUCCEEDED" ? "COLLECTED" : a.status === "FAILED" ? "REJECTED" : "PENDING")} {m(a.amountMinor, run.currency)} {a.failureCode ?? a.providerRef ?? a.payoutRef ?? ""}</li>)}</ul>
      <h3 className="mb-1 mt-3 text-sm font-semibold">{t("commissions.drill.timeline")}</h3>
      <ol className="text-sm" data-testid="com-timeline">{timeline.map((e) => <li key={e.id}><span className="text-muted-foreground">{formatDateTime(e.at, i18n.language)}</span> {e.event} <span className="text-xs text-muted-foreground">{e.actor}</span></li>)}</ol>
    </section>
  );
}

function OrgPanel({ org }: { org: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ["com", "org", org], queryFn: () => rawApi<OrgDetail>("GET", `${B}/orgs/${encodeURIComponent(org)}`) });
  if (!q.data) return null;
  return <section className="mt-6 rounded-xl border bg-card p-4" data-testid="com-org-panel"><h2 className="text-base font-semibold">{t("commissions.drill.config")}</h2>
    {q.data.config.missing.length ? <p className="text-sm text-muted-foreground">{t("commissions.drill.notConfigured")} ({q.data.config.missing.join(", ")})</p> : <pre dir="ltr" className="overflow-auto text-xs">{JSON.stringify(q.data.config.settings, null, 1)}</pre>}
    <p className="mt-2 text-sm">{t("commissions.col.provider")}: {q.data.provider ?? "-"}</p></section>;
}

function Config({ org }: { org: string | null }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ["com", "cfg", org], queryFn: () => rawApi<Policy[]>("GET", `${B}/config${org ? `?scope=ORG&scopeRef=${encodeURIComponent(org)}` : ""}`) });
  if (q.isLoading) return <CardSkeleton rows={2} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <DataTable caption={t("commissions.tabs.config")} rows={q.data!} rowKey={(r) => r.id} empty={t("commissions.drill.notConfigured")} columns={[
    { key: "s", header: t("commissions.col.scope"), cell: (r) => `${r.scope} ${r.scopeRef}` }, { key: "v", header: t("commissions.col.version"), cell: (r) => r.version }, { key: "st", header: t("commissions.col.status"), cell: (r) => <Badge variant={r.status === "ACTIVE" ? "success" : "secondary"}>{t(`commissions.status.${r.status}`, { defaultValue: r.status })}</Badge> },
    { key: "p", header: t("commissions.col.proposedBy"), cell: (r) => r.proposedBy }, { key: "x", header: t("commissions.col.setting"), cell: (r) => <code dir="ltr" className="text-xs">{JSON.stringify(r.settings)}</code> },
  ]} />;
}
