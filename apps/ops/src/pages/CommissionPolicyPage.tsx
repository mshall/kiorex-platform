import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { rawApi, rawText } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardSkeleton, ErrorState } from "@/components/states";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatMinor, localToIso } from "@/lib/format";

/**
 * COM-3 Commission policy: funds-flow counsel sign-off per market, provider-facing disclosure texts (AR and EN, free text, none shipped), the status of every real-money gate and the history of both.
 * super admin + finance read; only a super admin proposes; a different super admin approves (enforced by the API and the database). Nothing on this page is a legal clearance.
 */
type Counsel = { status: string; reviewerName: string; documentId: string; reviewedOn: string; conditions: string; collectionModes: string[]; payoutRoutes: string[] };
type Text = { en: string; ar: string };
type Disclosure = { rateDisclosure: Text; termsSummary: Text; showOverrideReason: boolean };
type Row = { id: string; kind: string; version: number; status: string; payload: Record<string, unknown>; effectiveFrom: string | null; createdBy: string; approvedBy: string | null; reason: string | null };
type Gate = { kind: string; key: string; allowed: boolean; reason: string; status: string; conditions: string | null };
type State = {
  market: string; paymentMode: string; realBlocked: number; gates: Gate[];
  counsel: { record: Counsel; version: number | null; effectiveFrom: string | null; source: string; pending: Row | null; history: Row[] };
  disclosure: { disclosure: Disclosure; version: number | null; wordingSet: boolean; missing: { rateDisclosure: string[]; termsSummary: string[] }; source: string; pending: Row | null; history: Row[] };
};
type Caps = { read: boolean; proposeConfig?: boolean; approveConfig?: boolean; export?: boolean };
type Kind = { accruedMinor: number; nettedMinor: number; openMinor: number; charges: number };
type Statement = { orgRef: string; currency: string; onlineCollectionsMinor: number; cashVisitCommissionAccruedMinor: number; cashVisitCommissionNettedMinor: number; cashVisitCommissionOpenMinor: number; cashBreakdown?: { cash: Kind; cashTransfer: Kind & { byDetail: Record<string, number>; unspecifiedDetail: number } }; unknownTender?: { charges: number; commissionMinor: number }; deductions: { commissionMinor: number; feesMinor: number | null; refundsMinor: number; chargebacksMinor: number }; netPayableMinor: number; paidByBankTransferMinor: number; reconciliation: string; payouts: { payoutRef: string; bankReference: string | null; reconciliation: string; cashMinor: number }[] };
const B = "/admin/commissions";
const MODES = ["NET_FROM_PAYOUT", "AUTO_CHARGE_SAVED_METHOD", "INVOICE_AND_COLLECT"];
const ROUTES = ["PAYMOB", "FAWRY", "INSTAPAY", "CARD_GATEWAY", "BANK_IPN"];
const STATUSES = ["NOT_REVIEWED", "APPROVED_WITH_CONDITIONS", "APPROVED", "REJECTED"];
const tone = (s: string) => (s === "APPROVED" ? "success" : s === "APPROVED_WITH_CONDITIONS" ? "warning" : s === "REJECTED" ? "destructive" : "secondary") as "success" | "warning" | "destructive" | "secondary";
const field = "grid min-w-0 gap-1 text-sm";
const selectCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";
const area = "min-h-24 w-full rounded-xl border border-input bg-card p-3 text-sm";

function Wrap({ title, testid, children }: { title: string; testid: string; children: React.ReactNode }) {
  return <section className="min-w-0 rounded-xl border bg-card p-4 shadow-card" data-testid={testid} aria-label={title}><h2 className="text-base font-semibold">{title}</h2>{children}</section>;
}

function History({ rows, caps, onDecide, summary }: { rows: Row[]; caps: Caps; onDecide: (id: string, approve: boolean) => void; summary: (r: Row) => string }) {
  const { t, i18n } = useTranslation();
  if (!rows.length) return <p className="mt-2 text-sm text-muted-foreground" data-testid="policy-history-empty">{t("commissions.policyPage.noHistory")}</p>;
  return <div className="relative mt-2 max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={t("commissions.policyPage.history")}><table className="w-full min-w-[34rem] text-start text-sm"><caption className="sr-only">{t("commissions.policyPage.history")}</caption>
    <thead><tr className="text-xs text-muted-foreground"><th scope="col" className="p-2 text-start">{t("commissions.col.version")}</th><th scope="col" className="p-2 text-start">{t("commissions.policyPage.what")}</th><th scope="col" className="p-2 text-start">{t("commissions.policyPage.from")}</th><th scope="col" className="p-2 text-start">{t("commissions.policyPage.status")}</th><th scope="col" className="p-2 text-start">{t("commissions.policyPage.reason")}</th><th scope="col" className="p-2"><span className="sr-only">{t("commissions.policyPage.actions")}</span></th></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.id} className="border-t" data-testid={`policy-row-${r.id}`}>
      <td className="p-2" dir="ltr">v{r.version}</td><td className="p-2">{summary(r)}</td><td className="p-2">{r.effectiveFrom ? formatDateTime(r.effectiveFrom, i18n.language) : "-"}</td>
      <td className="p-2"><Badge variant={r.status === "ACTIVE" ? "success" : r.status === "PENDING_APPROVAL" ? "warning" : "secondary"}>{t(`commissions.policyPage.rowStatus.${r.status}`, { defaultValue: r.status })}</Badge></td>
      <td className="p-2">{r.reason ?? "-"}</td>
      <td className="p-2">{r.status === "PENDING_APPROVAL" && caps.approveConfig && <span className="flex gap-1"><Button size="sm" onClick={() => onDecide(r.id, true)} data-testid="policy-approve">{t("commissions.rates.approve")}</Button><Button size="sm" variant="outline" onClick={() => onDecide(r.id, false)} data-testid="policy-reject">{t("commissions.policyPage.reject")}</Button></span>}</td>
    </tr>)}</tbody></table></div>;
}

function CounselForm({ cur, onSubmit, busy }: { cur: Counsel; onSubmit: (payload: Counsel, reason: string, from?: string) => void; busy: boolean }) {
  const { t } = useTranslation();
  const [v, setV] = useState<Counsel>({ ...cur }); const [reason, setReason] = useState(""); const [from, setFrom] = useState("");
  const toggle = (k: "collectionModes" | "payoutRoutes", x: string) => setV({ ...v, [k]: v[k].includes(x) ? v[k].filter((y) => y !== x) : [...v[k], x] });
  const approved = v.status === "APPROVED" || v.status === "APPROVED_WITH_CONDITIONS";
  const ok = reason.trim().length >= 5 && (!approved || (v.reviewerName.trim() && v.documentId.trim() && v.reviewedOn)) && (v.status !== "APPROVED_WITH_CONDITIONS" || v.conditions.trim()) && (v.status !== "REJECTED" || v.reviewerName.trim());
  return <form data-testid="counsel-form" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit(approved || v.status === "REJECTED" ? v : { ...v, collectionModes: [], payoutRoutes: [] }, reason, localToIso(from)); }}>
    <label className={field}>{t("commissions.policyPage.counsel.status")}<select className={selectCls} value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} data-testid="counsel-status">{STATUSES.map((s) => <option key={s} value={s}>{t(`commissions.policyPage.counselStatus.${s}`)}</option>)}</select></label>
    <label className={field}>{t("commissions.policyPage.counsel.reviewer")}<Input maxLength={120} value={v.reviewerName} onChange={(e) => setV({ ...v, reviewerName: e.target.value })} data-testid="counsel-reviewer" /></label>
    <label className={field}>{t("commissions.policyPage.counsel.document")}<Input dir="ltr" maxLength={120} value={v.documentId} onChange={(e) => setV({ ...v, documentId: e.target.value })} data-testid="counsel-document" /></label>
    <label className={field}>{t("commissions.policyPage.counsel.date")}<Input dir="ltr" type="date" value={v.reviewedOn} onChange={(e) => setV({ ...v, reviewedOn: e.target.value })} data-testid="counsel-date" /></label>
    <label className={`${field} sm:col-span-2`}>{t("commissions.policyPage.counsel.conditions")}<textarea className={area} maxLength={2000} value={v.conditions} onChange={(e) => setV({ ...v, conditions: e.target.value })} data-testid="counsel-conditions" /></label>
    <fieldset className="rounded-xl border p-3"><legend className="px-1 text-sm font-semibold">{t("commissions.policyPage.counsel.modes")}</legend>{MODES.map((m) => <label key={m} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={v.collectionModes.includes(m)} disabled={!approved} onChange={() => toggle("collectionModes", m)} />{t(`commissions.modes.${m}`, { defaultValue: m })}</label>)}</fieldset>
    <fieldset className="rounded-xl border p-3"><legend className="px-1 text-sm font-semibold">{t("commissions.policyPage.counsel.routes")}</legend>{ROUTES.map((m) => <label key={m} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={v.payoutRoutes.includes(m)} disabled={!approved} onChange={() => toggle("payoutRoutes", m)} /><span dir="ltr">{m}</span></label>)}</fieldset>
    <label className={field}>{t("commissions.rates.form.effectiveFrom")}<Input type="datetime-local" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
    <label className={field}>{t("commissions.policyPage.reasonLabel")}<Input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="counsel-reason" /></label>
    <div className="sm:col-span-2"><Button type="submit" disabled={!ok || busy} data-testid="counsel-submit">{t("commissions.rates.form.propose")}</Button> <span className="ms-2 text-xs text-muted-foreground">{t("commissions.policyPage.makerChecker")}</span></div>
  </form>;
}

function DisclosureForm({ cur, onSubmit, busy }: { cur: Disclosure; onSubmit: (p: Disclosure, reason: string, from?: string) => void; busy: boolean }) {
  const { t } = useTranslation();
  const [v, setV] = useState<Disclosure>(JSON.parse(JSON.stringify(cur))); const [reason, setReason] = useState(""); const [from, setFrom] = useState("");
  const set = (k: "rateDisclosure" | "termsSummary", l: "en" | "ar", x: string) => setV({ ...v, [k]: { ...v[k], [l]: x } });
  return <form data-testid="disclosure-form" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 5) onSubmit(v, reason, localToIso(from)); }}>
    {(["rateDisclosure", "termsSummary"] as const).map((k) => (["en", "ar"] as const).map((l) => <label key={k + l} className={field}>{t(`commissions.policyPage.disclosure.${k}`)} ({l.toUpperCase()})<textarea dir={l === "ar" ? "rtl" : "ltr"} lang={l} className={area} maxLength={4000} value={v[k][l]} onChange={(e) => set(k, l, e.target.value)} data-testid={`disclosure-${k}-${l}`} /></label>))}
    <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.showOverrideReason} onChange={(e) => setV({ ...v, showOverrideReason: e.target.checked })} data-testid="disclosure-show-reason" />{t("commissions.policyPage.disclosure.showReason")}</label>
    <label className={field}>{t("commissions.rates.form.effectiveFrom")}<Input type="datetime-local" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
    <label className={field}>{t("commissions.policyPage.reasonLabel")}<Input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="disclosure-reason" /></label>
    <div className="sm:col-span-2"><Button type="submit" disabled={reason.trim().length < 5 || busy} data-testid="disclosure-submit">{t("commissions.rates.form.propose")}</Button></div>
  </form>;
}

function Settlement({ canExport }: { canExport: boolean }) {
  const { t, i18n } = useTranslation(); const [org, setOrg] = useState(""); const [asked, setAsked] = useState("");
  const q = useQuery({ queryKey: ["com", "settlement", asked], enabled: !!asked, queryFn: () => rawApi<Statement>("GET", `${B}/settlement-statement/${encodeURIComponent(asked)}`) });
  const m = (n: number | null) => (n === null ? t("commissions.policyPage.na") : formatMinor(n, i18n.language, q.data?.currency));
  const exp = async () => { const csv = await rawText(`${B}/settlement-statement/${encodeURIComponent(asked)}/export`); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `settlement-${asked}.csv`; a.click(); };
  return <Wrap title={t("commissions.policyPage.settlement.title")} testid="policy-settlement">
    <p className="mt-1 text-sm text-muted-foreground">{t("commissions.policyPage.settlement.hint")}</p>
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setAsked(org.trim()); }}><label className={field}>{t("commissions.policyPage.settlement.org")}<Input dir="ltr" value={org} onChange={(e) => setOrg(e.target.value)} data-testid="settlement-org" /></label><Button type="submit" size="sm" disabled={!org.trim()} data-testid="settlement-go">{t("commissions.policyPage.settlement.show")}</Button>{asked && canExport && <Button type="button" size="sm" variant="outline" onClick={() => void exp()}>{t("commissions.actions.export")}</Button>}</form>
    {q.isLoading && asked && <CardSkeleton rows={2} />}
    {q.data && <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="settlement-figures">
      {([["online", q.data.onlineCollectionsMinor], ["cashAccrued", q.data.cashVisitCommissionAccruedMinor], ["cashNetted", q.data.cashVisitCommissionNettedMinor], ...(q.data.cashBreakdown ? [["cashOnlyAccrued", q.data.cashBreakdown.cash.accruedMinor], ["cashTransferAccrued", q.data.cashBreakdown.cashTransfer.accruedMinor], ["cashTransferNetted", q.data.cashBreakdown.cashTransfer.nettedMinor]] as [string, number | null][] : []), ["dedCommission", q.data.deductions.commissionMinor], ["dedFees", q.data.deductions.feesMinor], ["dedRefunds", q.data.deductions.refundsMinor], ["dedChargebacks", q.data.deductions.chargebacksMinor], ["net", q.data.netPayableMinor], ["paid", q.data.paidByBankTransferMinor]] as [string, number | null][]).map(([k, v]) => <div key={k} className="rounded-xl border p-3"><dt className="text-xs text-muted-foreground">{t(`commissions.policyPage.settlement.${k}`)}</dt><dd className="mt-1 text-sm font-semibold" dir="ltr">{m(v)}</dd></div>)}
      {q.data.unknownTender !== undefined && <div className="rounded-xl border p-3" data-testid="settlement-unknown-tender"><dt className="text-xs text-muted-foreground">{t("commissions.policyPage.settlement.unknownTender")}</dt><dd className="mt-1 text-sm font-semibold" dir="ltr">{q.data.unknownTender.charges}</dd></div>}
      <div className="rounded-xl border p-3"><dt className="text-xs text-muted-foreground">{t("commissions.policyPage.settlement.recon")}</dt><dd className="mt-1 text-sm font-semibold"><Badge variant={q.data.reconciliation === "MATCHED" ? "success" : q.data.reconciliation === "DISPUTED" ? "destructive" : "warning"}>{t(`commissions.policyPage.settlement.reconStatus.${q.data.reconciliation}`, { defaultValue: q.data.reconciliation })}</Badge></dd></div>
    </dl>}
    {q.data && q.data.payouts.length > 0 && <div className="relative mt-3 max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={t("commissions.policyPage.settlement.payouts")}><table className="w-full min-w-[28rem] text-start text-sm"><caption className="sr-only">{t("commissions.policyPage.settlement.payouts")}</caption><tbody>{q.data.payouts.map((p) => <tr key={p.payoutRef} className="border-t"><td className="p-2" dir="ltr">{p.payoutRef}</td><td className="p-2" dir="ltr">{p.bankReference ?? "-"}</td><td className="p-2" dir="ltr">{m(p.cashMinor)}</td><td className="p-2">{p.reconciliation}</td></tr>)}</tbody></table></div>}
  </Wrap>;
}

export default function CommissionPolicyPage() {
  const { t } = useTranslation(); const qc = useQueryClient(); const [market, setMarket] = useState("EG");
  const caps = useQuery({ queryKey: ["com", "caps"], queryFn: () => rawApi<Caps>("GET", `${B}/capabilities`) });
  const markets = useQuery({ queryKey: ["com", "policy", "markets"], queryFn: () => rawApi<{ markets: string[] }>("GET", `${B}/policy`) });
  const q = useQuery({ queryKey: ["com", "policy", market], queryFn: () => rawApi<State>("GET", `${B}/policy/${market}`) });
  const inv = () => void qc.invalidateQueries({ queryKey: ["com"] });
  const err = () => toast.error(t("commissions.policyPage.failed"));
  const send = useMutation({ mutationFn: (v: { kind: string; payload: object; reason: string; effectiveFrom?: string }) => rawApi("POST", `${B}/policy/${market}/propose`, v), onSuccess: () => { toast.success(t("commissions.rates.toast.proposed")); inv(); }, onError: err });
  const decide = useMutation({ mutationFn: (v: { id: string; approve: boolean }) => rawApi("POST", `${B}/policy/versions/${v.id}/decide`, { approve: v.approve }), onSuccess: () => { toast.success(t("commissions.rates.toast.decided")); inv(); }, onError: err });
  const c = caps.data ?? { read: false };
  const [open, setOpen] = useState<"counsel" | "disclosure" | null>(null);
  return <div>
    <PageHeader title={t("commissions.policyPage.title")} hint={t("commissions.policyPage.hint")} />
    <p className="mb-3 text-sm"><Link to="/commissions" className="underline" data-testid="policy-back">{t("commissions.policyPage.back")}</Link></p>
    <section className="mb-4 rounded-xl border border-dashed bg-muted p-4" data-testid="founder-direction" aria-label={t("commissions.policyPage.founder.title")}>
      <h2 className="text-base font-semibold">{t("commissions.policyPage.founder.title")} <span className="text-xs font-normal text-muted-foreground" dir="ltr">26 Nov 2026</span></h2>
      <ul className="mt-2 list-disc ps-5 text-sm"><li>{t("commissions.policyPage.founder.p1")}</li><li>{t("commissions.policyPage.founder.p2")}</li><li>{t("commissions.policyPage.founder.p3")}</li></ul>
      <p className="mt-2 text-xs text-muted-foreground">{t("commissions.policyPage.founder.note")}</p>
    </section>
    <label className="mb-4 flex items-center gap-2 text-sm">{t("commissions.policyPage.market")}<select className={`${selectCls} w-auto`} value={market} onChange={(e) => setMarket(e.target.value)} data-testid="policy-market">{(markets.data?.markets ?? ["EG"]).map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
    {q.isLoading ? <CardSkeleton rows={3} /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (() => {
      const s = q.data; const rec = s.counsel.record;
      return <div className="grid grid-cols-1 gap-4">
        <p role="status" className="rounded-xl border bg-card px-4 py-2 text-sm" data-testid="policy-mode">{t("commissions.policyPage.paymentMode")}: <b>{t(`commissions.policyPage.mode.${s.paymentMode}`)}</b> · {t("commissions.policyPage.realBlocked", { count: s.realBlocked })}</p>
        <Wrap title={t("commissions.policyPage.gates.title")} testid="policy-gates">
          <p className="mt-1 text-sm text-muted-foreground">{t("commissions.policyPage.gates.hint")}</p>
          <div className="relative mt-2 max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={t("commissions.policyPage.gates.title")}><table className="w-full min-w-[30rem] text-start text-sm"><caption className="sr-only">{t("commissions.policyPage.gates.title")}</caption>
            <thead><tr className="text-xs text-muted-foreground"><th scope="col" className="p-2 text-start">{t("commissions.policyPage.gates.kind")}</th><th scope="col" className="p-2 text-start">{t("commissions.policyPage.gates.key")}</th><th scope="col" className="p-2 text-start">{t("commissions.policyPage.gates.realMode")}</th><th scope="col" className="p-2 text-start">{t("commissions.policyPage.reason")}</th></tr></thead>
            <tbody>{s.gates.map((g) => <tr key={g.kind + g.key} className="border-t" data-testid={`gate-${g.kind}-${g.key}`}><td className="p-2">{t(`commissions.policyPage.gates.kinds.${g.kind}`)}</td><td className="p-2" dir="ltr">{g.key}</td><td className="p-2"><Badge variant={g.allowed ? "success" : "destructive"}>{g.allowed ? t("commissions.policyPage.gates.allowed") : t("commissions.policyPage.gates.blocked")}</Badge></td><td className="p-2">{t(`commissions.policyPage.gateReason.${g.reason}`, { defaultValue: g.reason })}</td></tr>)}</tbody></table></div>
        </Wrap>
        <Wrap title={t("commissions.policyPage.counsel.title")} testid="policy-counsel">
          <p className="mt-1 text-sm text-muted-foreground">{t("commissions.policyPage.counsel.hint")}</p>
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="counsel-record">
            <div className="rounded-xl border p-3"><dt className="text-xs text-muted-foreground">{t("commissions.policyPage.counsel.status")}</dt><dd className="mt-1"><Badge variant={tone(rec.status)} data-testid="counsel-current">{t(`commissions.policyPage.counselStatus.${rec.status}`)}</Badge></dd></div>
            <div className="rounded-xl border p-3"><dt className="text-xs text-muted-foreground">{t("commissions.policyPage.counsel.reviewer")}</dt><dd className="mt-1 text-sm font-semibold">{rec.reviewerName || "-"}</dd></div>
            <div className="rounded-xl border p-3"><dt className="text-xs text-muted-foreground">{t("commissions.policyPage.counsel.document")}</dt><dd className="mt-1 text-sm font-semibold" dir="ltr">{rec.documentId || "-"}</dd></div>
            <div className="rounded-xl border p-3"><dt className="text-xs text-muted-foreground">{t("commissions.policyPage.counsel.date")}</dt><dd className="mt-1 text-sm font-semibold" dir="ltr">{rec.reviewedOn || "-"}</dd></div>
          </dl>
          {rec.conditions && <p className="mt-2 text-sm"><b>{t("commissions.policyPage.counsel.conditions")}:</b> {rec.conditions}</p>}
          {s.counsel.pending && <p className="mt-2 text-sm" data-testid="counsel-pending"><Badge variant="warning">{t("commissions.status.PENDING")}</Badge></p>}
          {c.proposeConfig && !s.counsel.pending && <Button size="sm" variant="outline" className="mt-3" onClick={() => setOpen(open === "counsel" ? null : "counsel")} data-testid="counsel-open">{t("commissions.rates.change")}</Button>}
          {open === "counsel" && <CounselForm cur={rec} busy={send.isPending} onSubmit={(payload, reason, effectiveFrom) => { send.mutate({ kind: "COMMISSION_COUNSEL_SIGNOFF", payload, reason, effectiveFrom }); setOpen(null); }} />}
          <h3 className="mt-4 text-sm font-semibold">{t("commissions.policyPage.history")}</h3>
          <History rows={s.counsel.history} caps={c} onDecide={(id, approve) => decide.mutate({ id, approve })} summary={(r) => t(`commissions.policyPage.counselStatus.${String(r.payload.status)}`, { defaultValue: String(r.payload.status) })} />
        </Wrap>
        <Wrap title={t("commissions.policyPage.disclosure.title")} testid="policy-disclosure">
          <p className="mt-1 text-sm text-muted-foreground">{t("commissions.policyPage.disclosure.hint")}</p>
          {!s.disclosure.wordingSet ? <p role="status" className="mt-3 rounded-xl border border-warning/60 bg-warning-soft px-4 py-2 text-sm text-warning" data-testid="wording-not-set">{t("commissions.policyPage.disclosure.notSet")}</p> : <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="wording-set">
            {(["rateDisclosure", "termsSummary"] as const).map((k) => (["en", "ar"] as const).map((l) => <div key={k + l} className="min-w-0 rounded-xl border p-3"><div className="text-xs text-muted-foreground">{t(`commissions.policyPage.disclosure.${k}`)} ({l.toUpperCase()})</div><p className="mt-1 whitespace-pre-wrap break-words text-sm" dir={l === "ar" ? "rtl" : "ltr"} lang={l}>{s.disclosure.disclosure[k][l] || t("commissions.policyPage.disclosure.langMissing")}</p></div>))}
          </div>}
          <p className="mt-2 text-sm" data-testid="reason-visibility">{t("commissions.policyPage.disclosure.showReason")}: <b>{s.disclosure.disclosure.showOverrideReason ? t("commissions.policyPage.yes") : t("commissions.policyPage.no")}</b></p>
          {s.disclosure.pending && <p className="mt-2 text-sm"><Badge variant="warning">{t("commissions.status.PENDING")}</Badge></p>}
          {c.proposeConfig && !s.disclosure.pending && <Button size="sm" variant="outline" className="mt-3" onClick={() => setOpen(open === "disclosure" ? null : "disclosure")} data-testid="disclosure-open">{t("commissions.rates.change")}</Button>}
          {open === "disclosure" && <DisclosureForm cur={s.disclosure.disclosure} busy={send.isPending} onSubmit={(payload, reason, effectiveFrom) => { send.mutate({ kind: "COMMISSION_DISCLOSURE", payload, reason, effectiveFrom }); setOpen(null); }} />}
          <h3 className="mt-4 text-sm font-semibold">{t("commissions.policyPage.history")}</h3>
          <History rows={s.disclosure.history} caps={c} onDecide={(id, approve) => decide.mutate({ id, approve })} summary={(r) => ((r.payload as { rateDisclosure?: Text }).rateDisclosure?.en || (r.payload as { rateDisclosure?: Text }).rateDisclosure?.ar ? t("commissions.policyPage.disclosure.wordingEntered") : t("commissions.policyPage.disclosure.notSetShort"))} />
        </Wrap>
        {c.read && <Settlement canExport={!!c.export} />}
      </div>;
    })()}
  </div>;
}
