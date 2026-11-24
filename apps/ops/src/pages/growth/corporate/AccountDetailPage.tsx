import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAccount, useAccountAction, useAddInvoiceNote, useDecideHr, useHrLists, useInvoiceNotes, useReport, useUpdateTerms, useUploadHr, type Account } from "@/api/corporate";
import { useGrowthAccess } from "@/api/growth";
import { GrowthPage, Section } from "@/components/growth/GrowthPage";
import { FormField, StatCard, StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { fmtN } from "@/lib/growthFormat";
import { formatDateTime } from "@/lib/format";
import CodesPage from "./CodesPage";
import { accountTone } from "./CorporateAccountsPage";

const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";
const egp = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : String(minor / 100));
const toMinor = (v: string): number | null => (v.trim() === "" ? null : Math.round(Number(v) * 100));
const MASK = "<10";

function TermsForm({ a, canManage }: { a: Account; canManage: boolean }) {
  const { t } = useTranslation(); const save = useUpdateTerms(); const frozen = a.status === "ACTIVE" || a.status === "ENDED";
  const [f, setF] = useState({ contractRef: a.contractRef ?? "", ceiling: egp(a.terms.sponsorCeilingMinor), cap: egp(a.terms.perMemberCapMinor), visit: egp(a.terms.perVisitMaxMinor), pct: a.terms.coverBp ? String(a.terms.coverBp / 100) : "", ends: a.endsAt ? a.endsAt.slice(0, 10) : "", domains: a.emailDomains.join(", ") });
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the form follows the server record after a save
  useEffect(() => { setF({ contractRef: a.contractRef ?? "", ceiling: egp(a.terms.sponsorCeilingMinor), cap: egp(a.terms.perMemberCapMinor), visit: egp(a.terms.perVisitMaxMinor), pct: a.terms.coverBp ? String(a.terms.coverBp / 100) : "", ends: a.endsAt ? a.endsAt.slice(0, 10) : "", domains: a.emailDomains.join(", ") }); }, [a]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ id: a.id, body: { contractRef: f.contractRef.trim() || null, sponsorCeilingMinor: toMinor(f.ceiling), perMemberCapMinor: toMinor(f.cap), perVisitMaxMinor: toMinor(f.visit), coverBp: f.pct.trim() === "" ? null : Math.round(Number(f.pct) * 100), endsAt: f.ends ? new Date(`${f.ends}T23:59:59Z`).toISOString() : null, emailDomains: f.domains.split(",").map((x) => x.trim()).filter(Boolean) } },
      { onSuccess: () => toast.success(t("growth.corporate.termsSaved")), onError: (er) => toast.error((er as Error).message) });
  };
  return (
    <Section title={t("growth.corporate.terms")} id="corp-terms" hint={t("growth.corporate.termsHint")}>
      <p className="mb-3 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm" data-testid="corp-needs-human" data-needs-human="true">{t("growth.corporate.needsHuman")}</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" data-testid="corp-terms-form">
        <FormField label={t("growth.corporate.contractRef")} hint={t("growth.corporate.contractRefHint")}><input className={inputCls} value={f.contractRef} onChange={set("contractRef")} disabled={frozen || !canManage} data-testid="corp-contract" /></FormField>
        <FormField label={t("growth.corporate.endsAt")}><input type="date" className={inputCls} value={f.ends} onChange={set("ends")} disabled={frozen || !canManage} data-testid="corp-ends" /></FormField>
        <FormField label={t("growth.corporate.ceiling")} hint={t("growth.corporate.ceilingHint")}><input className={inputCls} inputMode="decimal" value={f.ceiling} onChange={set("ceiling")} disabled={frozen || !canManage} data-testid="corp-ceiling" /></FormField>
        <FormField label={t("growth.corporate.memberCap")}><input className={inputCls} inputMode="decimal" value={f.cap} onChange={set("cap")} disabled={frozen || !canManage} data-testid="corp-cap" /></FormField>
        <FormField label={t("growth.corporate.visitMax")} hint={t("growth.corporate.visitMaxHint")}><input className={inputCls} inputMode="decimal" value={f.visit} onChange={set("visit")} disabled={frozen || !canManage} data-testid="corp-visit" /></FormField>
        <FormField label={t("growth.corporate.coverPct")} hint={t("growth.corporate.coverPctHint")}><input className={inputCls} inputMode="decimal" value={f.pct} onChange={set("pct")} disabled={frozen || !canManage} data-testid="corp-pct" /></FormField>
        <FormField label={t("growth.corporate.domains")} hint={t("growth.corporate.domainsHint")} className="sm:col-span-2"><input className={inputCls} dir="ltr" value={f.domains} onChange={set("domains")} disabled={frozen || !canManage} data-testid="corp-domains" /></FormField>
        {canManage && <div className="sm:col-span-2"><button type="submit" className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={frozen || save.isPending} data-testid="corp-terms-save">{t("growth.corporate.saveTerms")}</button>{frozen && <span className="ms-3 text-sm text-muted-foreground" data-testid="corp-frozen">{t("growth.corporate.frozen")}</span>}</div>}
      </form>
    </Section>
  );
}

function ReportPanel({ id }: { id: string }) {
  const { t } = useTranslation(); const q = useReport(id);
  const cell = (v: number | null | undefined) => (v === null || v === undefined ? MASK : fmtN(v));
  const money = (v: number | null) => (v === null ? MASK : fmtN(Math.round(v / 100)));
  return (
    <Section title={t("growth.corporate.report")} id="corp-report" hint={t("growth.corporate.reportHint", { k: q.data?.k ?? 10 })}>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4" data-testid="corp-report-cards">
            <StatCard label={t("growth.corporate.enrolled")} value={cell(q.data.enrolment.enrolled)} />
            <StatCard label={t("growth.corporate.activeMembers")} value={cell(q.data.enrolment.active)} />
            <StatCard label={t("growth.corporate.usedBenefit")} value={cell(q.data.utilisation.membersWhoUsedBenefit)} />
            <StatCard label={t("growth.corporate.sponsoredValue")} value={money(q.data.utilisation.sponsoredValueMinor)} hint={q.data.currency} />
          </div>
          <p className="text-sm text-muted-foreground" data-testid="corp-report-note">{q.data.suppressed.length ? t("growth.corporate.suppressedNote", { k: q.data.k }) : t("growth.corporate.noSuppression")}</p>
          <ul className="flex flex-wrap gap-2" aria-label={t("growth.corporate.byVerification")}>{(["CODE", "HR_LIST", "DOMAIN_EMAIL"] as const).map((k) => <li key={k}><StatusChip tone="neutral" dot={false}>{t(`growth.corporate.via.${k}`)}: {cell(q.data!.enrolment.byVerification[k])}</StatusChip></li>)}</ul>
        </div>)}
    </Section>
  );
}

function HrPanel({ id, canManage }: { id: string; canManage: boolean }) {
  const { t, i18n } = useTranslation(); const q = useHrLists(id); const up = useUploadHr(); const decide = useDecideHr(); const [text, setText] = useState("");
  const rows = text.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  const onFile = async (f?: File) => { if (f) setText(await f.text()); };
  return (
    <Section title={t("growth.corporate.hr")} id="corp-hr" hint={t("growth.corporate.hrHint")}>
      {canManage && (
        <div className="mb-4 space-y-2" data-testid="corp-hr-form">
          <FormField label={t("growth.corporate.hrRows")} hint={t("growth.corporate.hrRowsHint")}><textarea className="min-h-28 w-full rounded-xl border border-input bg-card p-3 text-sm" dir="ltr" value={text} onChange={(e) => setText(e.target.value)} data-testid="corp-hr-text" /></FormField>
          <div className="flex flex-wrap items-center gap-3"><label className="inline-flex h-11 cursor-pointer items-center rounded-xl border px-4 text-sm font-semibold">{t("growth.corporate.hrFile")}<input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="corp-hr-file" /></label>
            <button type="button" className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!rows.length || up.isPending} onClick={() => up.mutate({ id, rows }, { onSuccess: (r) => { setText(""); toast.success(t("growth.corporate.hrUploaded", { n: r.rowCount })); }, onError: (er) => toast.error((er as Error).message) })} data-testid="corp-hr-upload">{t("growth.corporate.hrUpload", { n: rows.length })}</button></div>
        </div>)}
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <DataTable caption={t("growth.corporate.hr")} rows={q.data?.items ?? []} rowKey={(r) => r.id} empty={t("growth.corporate.noHr")} columns={[
          { key: "s", header: t("growth.corporate.colStatus"), cell: (r) => <StatusChip tone={r.status === "APPROVED" ? "success" : r.status === "PENDING_APPROVAL" ? "warning" : "neutral"}>{t(`growth.corporate.hrStatus.${r.status}`)}</StatusChip> },
          { key: "n", header: t("growth.corporate.hrCount"), cell: (r) => <span className="tabular-nums">{fmtN(r.rowCount)}</span> },
          { key: "w", header: t("growth.corporate.hrWindow"), cell: (r) => <span className="text-xs">{r.windowEndsAt ? formatDateTime(r.windowEndsAt, i18n.language) : "-"}</span> },
          { key: "a", header: "", cell: (r) => canManage && r.status === "PENDING_APPROVAL" ? <span className="flex gap-2"><button type="button" className="h-11 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground" onClick={() => decide.mutate({ batchId: r.id, decision: "APPROVED" }, { onError: (er) => toast.error((er as Error).message) })} data-testid={`corp-hr-approve-${r.id}`}>{t("growth.corporate.approve")}</button><button type="button" className="h-11 rounded-xl border px-3 text-sm" onClick={() => decide.mutate({ batchId: r.id, decision: "REJECTED" })}>{t("growth.corporate.reject")}</button></span> : null },
        ]} />)}
    </Section>
  );
}

function InvoicePanel({ id, canManage }: { id: string; canManage: boolean }) {
  const { t } = useTranslation(); const q = useInvoiceNotes(id); const add = useAddInvoiceNote(); const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); const [notes, setNotes] = useState("");
  return (
    <Section title={t("growth.corporate.invoice")} id="corp-invoice" hint={t("growth.corporate.invoiceHint")}>
      {canManage && <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); add.mutate({ id, month, notes }, { onSuccess: () => { setNotes(""); toast.success(t("growth.corporate.noteSaved")); }, onError: (er) => toast.error((er as Error).message) }); }} data-testid="corp-note-form">
        <FormField label={t("growth.corporate.month")}><input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} /></FormField>
        <FormField label={t("growth.corporate.noteText")} className="min-w-64 flex-1"><input className={inputCls} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></FormField>
        <button type="submit" className="h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!month || add.isPending}>{t("growth.corporate.saveNote")}</button></form>}
      <DataTable caption={t("growth.corporate.invoice")} rows={q.data?.items ?? []} rowKey={(r) => r.id} empty={t("growth.corporate.noNotes")} columns={[
        { key: "m", header: t("growth.corporate.month"), cell: (r) => <span dir="ltr">{r.month}</span> }, { key: "s", header: t("growth.corporate.sponsorSpend"), cell: (r) => <span className="tabular-nums">{fmtN(Math.round(r.sponsorSpendMinor / 100))}</span> }, { key: "n", header: t("growth.corporate.noteText"), cell: (r) => r.notes },
      ]} />
    </Section>
  );
}

/** One corporate account: the terms (a second person activates), codes, the aggregate report, HR lists and manual invoicing notes. No page here lists a member, a booking or a provider. */
export default function AccountDetailPage() {
  const { id = "" } = useParams(); const { t } = useTranslation(); const q = useAccount(id); const act = useAccountAction(); const access = useGrowthAccess().data; const canManage = !!access?.capabilities.manageCorporate;
  const a = q.data;
  const run = (op: "activate" | "pause" | "end") => act.mutate({ id, op }, { onSuccess: () => toast.success(t(`growth.corporate.done.${op}`)), onError: (er) => toast.error((er as Error).message) });
  return (
    <GrowthPage section="corporate">
      <Link to="/growth/corporate" className="inline-flex h-11 items-center text-sm font-semibold text-primary hover:underline">{t("growth.corporate.back")}</Link>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error || !a ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-5" data-testid="corp-detail">
          <div className="kx-card flex flex-wrap items-center gap-3 p-4">
            <h2 className="text-xl">{a.displayName}</h2><StatusChip tone={accountTone(a.status)}>{t(`growth.corporate.status.${a.status}`)}</StatusChip><span className="text-sm text-muted-foreground">{t(`growth.corporate.funding.${a.fundingMode}`)}</span>
            {canManage && <span className="ms-auto flex flex-wrap gap-2">
              {(a.status === "LEAD" || a.status === "PAUSED") && <button type="button" className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={act.isPending} onClick={() => run("activate")} data-testid="corp-activate">{t("growth.corporate.activate")}</button>}
              {a.status === "ACTIVE" && <button type="button" className="h-11 rounded-xl border px-4 text-sm font-semibold" onClick={() => run("pause")} data-testid="corp-pause">{t("growth.corporate.pause")}</button>}
              {a.status !== "ENDED" && <button type="button" className="h-11 rounded-xl border border-destructive/50 px-4 text-sm font-semibold text-destructive" onClick={() => { if (window.confirm(t("growth.corporate.endConfirm"))) run("end"); }} data-testid="corp-end">{t("growth.corporate.end")}</button>}
            </span>}
          </div>
          {a.status !== "ACTIVE" && a.status !== "ENDED" && <p className="rounded-xl border bg-card p-3 text-sm" data-testid="corp-two-person">{t("growth.corporate.twoPerson")}</p>}
          <TermsForm a={a} canManage={canManage} />
          <CodesPage accountId={id} canManage={canManage} />
          <ReportPanel id={id} />
          <HrPanel id={id} canManage={canManage} />
          <InvoicePanel id={id} canManage={canManage} />
        </div>)}
    </GrowthPage>
  );
}
