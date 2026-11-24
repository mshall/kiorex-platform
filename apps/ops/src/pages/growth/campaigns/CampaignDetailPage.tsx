import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { useApprovals, useCampaign, useCampaignActions, useCampaignCreatives, useCampaignHistory, useCampaignReport, useCampaignSpend, type Campaign, type CampaignStatus, type Masked } from "@/api/campaigns";
import { useGrowthAccess } from "@/api/growth";
import { DataTable, type Column } from "@/components/DataTable";
import { FormField, StatCard } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { GrowthPage, Section, selectCls } from "@/components/growth/GrowthPage";
import { BudgetMeter, CampaignStatusChip, toMinor, useErrorText, useMoney } from "@/components/growth/campaign-parts";
import { formatDateTime } from "@/lib/format";

const TABS = ["overview", "approvals", "spend", "creatives", "report", "history"] as const;
const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";
const btn = "inline-flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-50";
const NEEDS_REASON: CampaignStatus[] = ["DRAFT", "PAUSED"];

export default function CampaignDetailPage() {
  const { id } = useParams(); const { t, i18n } = useTranslation(); const [tab, setTab] = useState<(typeof TABS)[number]>("overview");
  const q = useCampaign(id); const access = useGrowthAccess(); const can = !!access.data?.capabilities.manageCampaigns;
  const c = q.data;
  return (
    <GrowthPage section="campaigns" actions={<Link className="text-sm font-semibold text-primary hover:underline" to="/growth/campaigns" data-testid="campaign-back">{t("growth.campaigns.detail.back")}</Link>}>
      {q.isLoading ? <CardSkeleton rows={3} /> : q.isError || !c ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="space-y-4" data-testid="campaign-detail" data-campaign-id={c.id}>
          <div className="kx-card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0"><h2 className="text-xl" data-testid="campaign-name">{c.name}</h2><p className="text-sm text-muted-foreground"><code dir="ltr" data-testid="campaign-tag">{c.utmCampaign}</code> · {t(`growth.campaigns.objective.${c.objective}`, { defaultValue: c.objective })} · {t("growth.campaigns.detail.owner")}: <code dir="ltr">{c.ownerSub}</code></p></div>
            <div className="flex flex-wrap items-center gap-2"><CampaignStatusChip status={c.status} />{c.pauseReason && c.status === "PAUSED" && <span className="text-xs text-warning" data-testid="pause-reason">{t(`growth.campaigns.detail.pauseReason.${c.pauseReason}`)}</span>}</div>
          </div>
          <div role="tablist" aria-label={c.name} className="flex flex-wrap gap-1 border-b">
            {TABS.map((x) => <button key={x} role="tab" id={`tab-${x}`} aria-selected={tab === x} aria-controls={`panel-${x}`} type="button" onClick={() => setTab(x)} data-testid={`tab-${x}`} className={`min-h-11 rounded-t-lg px-4 text-sm font-medium ${tab === x ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:bg-accent"}`}>{t(`growth.campaigns.detail.tabs.${x}`)}</button>)}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
            {tab === "overview" && <Overview c={c} can={can} />}
            {tab === "approvals" && <ApprovalsTab c={c} can={can} />}
            {tab === "spend" && <SpendTab c={c} can={can} />}
            {tab === "creatives" && <CreativesTab c={c} can={can} />}
            {tab === "report" && <ReportTab c={c} />}
            {tab === "history" && <HistoryTab c={c} lang={i18n.language} />}
          </div>
        </div>)}
    </GrowthPage>
  );
}

function Overview({ c, can }: { c: Campaign; can: boolean }) {
  const { t, i18n } = useTranslation(); const money = useMoney(); const acts = useCampaignActions(); const errText = useErrorText();
  const [ask, setAsk] = useState<CampaignStatus | null>(null); const [reason, setReason] = useState(""); const [err, setErr] = useState("");
  const go = (to: CampaignStatus, r?: string) => { setErr(""); acts.transition.mutate({ id: c.id, to, reason: r, reasonCode: r ? "OPS_REASON" : undefined }, { onSuccess: () => { toast.success(t("growth.campaigns.detail.moved")); setAsk(null); setReason(""); }, onError: (e) => setErr(errText(e)) }); };
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); toast.success(t("growth.campaigns.wizard.copied")); } catch { /* selectable text remains */ } };
  const elig = Object.entries(c.eligibility ?? {});
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="campaign-budget">
        <StatCard label={t("growth.campaigns.detail.budget")} value={money(c.budgetTotalMinor, c.currency)} hint={`${t("growth.campaigns.detail.daily")}: ${money(c.budgetDailyMinor, c.currency)}`} />
        <StatCard label={t("growth.campaigns.detail.approvedSpend")} value={money(c.budget.approvedSpendMinor, c.currency)} />
        <StatCard label={t("growth.campaigns.detail.pendingSpend")} value={money(c.budget.pendingSpendMinor, c.currency)} />
        <StatCard label={t("growth.campaigns.detail.remaining")} value={money(c.budget.remainingMinor, c.currency)} />
      </div>
      <BudgetMeter bp={c.budget.utilisationBp} label={t("growth.campaigns.report.budgetUsed")} />
      <Section title={t("growth.campaigns.detail.actions")} id="cd-actions">
        <div className="flex flex-wrap gap-2" data-testid="campaign-actions">
          {c.actions.map((a) => (
            <button key={a.to} type="button" disabled={!can || !a.allowed || acts.transition.isPending} title={a.allowed ? undefined : a.message} data-testid={`action-${a.to}`} data-allowed={a.allowed}
              className={`${btn} border bg-card hover:bg-accent`} onClick={() => (NEEDS_REASON.includes(a.to) ? setAsk(a.to) : go(a.to))}>{t(`growth.campaigns.detail.actionLabel.${a.to}`)}</button>))}
        </div>
        {c.actions.filter((a) => !a.allowed).length > 0 && <ul className="mt-2 list-disc ps-5 text-xs text-muted-foreground" data-testid="action-reasons">{c.actions.filter((a) => !a.allowed).map((a) => <li key={a.to}>{t(`growth.campaigns.detail.actionLabel.${a.to}`)}: {a.message}</li>)}</ul>}
        {ask && (<div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border bg-muted/40 p-3" data-testid="reason-box"><FormField label={t("growth.campaigns.detail.reasonPrompt")} className="min-w-64 flex-1"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reason-input" maxLength={300} /></FormField>
          <button type="button" className={`${btn} bg-primary text-primary-foreground`} disabled={reason.trim().length < 3 || acts.transition.isPending} onClick={() => go(ask, reason.trim())} data-testid="reason-confirm">{t("growth.campaigns.detail.confirm")}</button><button type="button" className={`${btn} border`} onClick={() => setAsk(null)}>{t("growth.campaigns.detail.cancel")}</button></div>)}
        {err && <p role="alert" className="mt-2 text-sm text-destructive" data-testid="action-error">{err}</p>}
        {!can && <p className="mt-2 text-xs text-muted-foreground">{t("growth.campaigns.detail.readOnly")}</p>}
      </Section>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title={t("growth.campaigns.detail.window")} id="cd-window"><p className="text-sm">{c.startsAt ? formatDateTime(c.startsAt, i18n.language) : "-"} {"→"} {c.endsAt ? formatDateTime(c.endsAt, i18n.language) : "-"}</p>{c.autoExpiresAt && <p className="text-xs text-muted-foreground">{t("growth.campaigns.detail.autoExpires", { at: formatDateTime(c.autoExpiresAt, i18n.language) })}</p>}</Section>
        <Section title={t("growth.campaigns.detail.approvalState")} id="cd-approval"><p className="text-sm" data-testid="approval-state">{c.approval.required ? <>{t("growth.campaigns.detail.approvalNeeded")}: {c.approval.reasons.map((r) => t(`growth.campaigns.detail.approvalReasons.${r}`)).join(", ")}</> : t("growth.campaigns.wizard.noApproval")}</p><p className="text-xs text-muted-foreground">{c.approval.current ? t("growth.campaigns.detail.approvalCurrent") : t("growth.campaigns.detail.approvalMissing")}</p></Section>
      </div>
      <Section title={t("growth.campaigns.detail.eligibility")} id="cd-elig">{elig.length === 0 ? <p className="text-sm">{t("growth.campaigns.detail.none")}</p> : <ul className="flex flex-wrap gap-2 text-xs" data-testid="eligibility-list">{elig.map(([k, v]) => <li key={k} className="rounded-full bg-muted px-3 py-1"><span className="font-semibold">{k}</span>: {Array.isArray(v) ? v.join(", ") : String(v)}</li>)}</ul>}</Section>
      <Section title={t("growth.campaigns.detail.links")} id="cd-links">
        <div className="space-y-2 text-sm" data-testid="campaign-links">
          {[[t("growth.campaigns.wizard.webUrl"), c.links.webUrl], [t("growth.campaigns.wizard.appLink"), c.links.appLink]].map(([l, u]) => (<div key={l} className="flex flex-wrap items-center gap-2"><span className="w-24 text-muted-foreground">{l}</span><code dir="ltr" className="min-w-0 flex-1 break-all text-xs">{u}</code><button type="button" className="inline-flex h-9 items-center gap-1 rounded-lg border px-2 text-xs font-semibold hover:bg-accent" onClick={() => void copy(u!)}><Copy className="h-3.5 w-3.5" aria-hidden="true" />{t("growth.campaigns.wizard.copy")}</button></div>))}
        </div>
      </Section>
    </div>
  );
}

function ApprovalsTab({ c, can }: { c: Campaign; can: boolean }) {
  const { t, i18n } = useTranslation(); const acts = useCampaignActions(); const errText = useErrorText(); const all = useApprovals(undefined); const mine = (all.data ?? []).filter((a) => a.campaignId === c.id);
  const [err, setErr] = useState(""); const [total, setTotal] = useState(""); const [daily, setDaily] = useState("");
  const ask = (kind: "ACTIVATE" | "BUDGET_INCREASE" | "REACTIVATE", extra: { budgetTotalMinor?: number; budgetDailyMinor?: number } = {}) => { setErr(""); acts.requestApproval.mutate({ id: c.id, kind, ...extra }, { onSuccess: () => toast.success(t("growth.campaigns.approvals.requested")), onError: (e) => setErr(errText(e)) }); };
  const can1 = (k: string) => can && !mine.some((a) => a.kind === k && !a.decision);
  return (
    <div className="space-y-4">
      <Section title={t("growth.campaigns.approvals.request")} id="ap-req">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btn} border hover:bg-accent`} disabled={!can1("ACTIVATE") || c.status !== "DRAFT"} onClick={() => ask("ACTIVATE")} data-testid="ask-activate">{t("growth.campaigns.approvals.kind.ACTIVATE")}</button>
          <button type="button" className={`${btn} border hover:bg-accent`} disabled={!can1("REACTIVATE") || c.status !== "PAUSED"} onClick={() => ask("REACTIVATE")} data-testid="ask-reactivate">{t("growth.campaigns.approvals.requestReactivate")}</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3"><FormField label={t("growth.campaigns.approvals.newTotal")}><input className={inputCls} dir="ltr" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} data-testid="inc-total" /></FormField><FormField label={t("growth.campaigns.approvals.newDaily")}><input className={inputCls} dir="ltr" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} data-testid="inc-daily" /></FormField>
          <div className="flex items-end"><button type="button" className={`${btn} border hover:bg-accent`} disabled={!can1("BUDGET_INCREASE") || !["SCHEDULED", "ACTIVE", "PAUSED"].includes(c.status) || !(Number(total) > 0 || Number(daily) > 0)} onClick={() => ask("BUDGET_INCREASE", { ...(Number(total) > 0 ? { budgetTotalMinor: toMinor(total) } : {}), ...(Number(daily) > 0 ? { budgetDailyMinor: toMinor(daily) } : {}) })} data-testid="ask-increase">{t("growth.campaigns.approvals.requestBudget")}</button></div></div>
        {err && <p role="alert" className="mt-2 text-sm text-destructive" data-testid="approval-error">{err}</p>}
      </Section>
      <Section title={t("growth.campaigns.approvals.title")} id="ap-list">
        {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.campaigns.approvals.none")}</p> : <ul className="space-y-2 text-sm" data-testid="approval-rows">{mine.map((a) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"><span>{t(`growth.campaigns.approvals.kind.${a.kind}`)} · {t("growth.campaigns.approvals.by", { who: a.requestedBy })} · {formatDateTime(a.requestedAt, i18n.language)}</span><span className="font-semibold">{a.decision ? t(`growth.campaigns.approvals.decision.${a.decision}`) : t("growth.campaigns.approvals.pending")}</span></li>)}</ul>}
        <p className="mt-2 text-xs text-muted-foreground"><Link className="text-primary hover:underline" to="/growth/approvals">{t("growth.sections.approvals.nav")}</Link></p>
      </Section>
    </div>
  );
}

function SpendTab({ c, can }: { c: Campaign; can: boolean }) {
  const { t } = useTranslation(); const money = useMoney(); const acts = useCampaignActions(); const errText = useErrorText(); const q = useCampaignSpend(c.id);
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10)); const [amount, setAmount] = useState(""); const [note, setNote] = useState(""); const [err, setErr] = useState("");
  return (
    <div className="space-y-4">
      <Section title={t("growth.campaigns.spend.title")} hint={t("growth.campaigns.spend.hint")} id="sp-add">
        <div className="grid gap-3 sm:grid-cols-4"><FormField label={t("growth.campaigns.spend.day")}><input type="date" className={inputCls} value={day} onChange={(e) => setDay(e.target.value)} data-testid="spend-day" /></FormField><FormField label={t("growth.campaigns.spend.amount")}><input className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="spend-amount" /></FormField><FormField label={t("growth.campaigns.spend.note")} className="sm:col-span-1"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></FormField>
          <div className="flex items-end"><button type="button" className={`${btn} bg-primary text-primary-foreground`} disabled={!can || !(Number(amount) > 0) || acts.addSpend.isPending} data-testid="spend-add" onClick={() => { setErr(""); acts.addSpend.mutate({ id: c.id, day, amountMinor: toMinor(amount), note: note || undefined }, { onSuccess: () => { toast.success(t("growth.campaigns.spend.added")); setAmount(""); setNote(""); }, onError: (e) => setErr(errText(e)) }); }}>{t("growth.campaigns.spend.add")}</button></div></div>
        {err && <p role="alert" className="mt-2 text-sm text-destructive" data-testid="spend-error">{err}</p>}
        <p className="mt-2 text-xs"><Link className="text-primary hover:underline" to="/growth/finance">{t("growth.campaigns.spend.finance")}</Link></p>
      </Section>
      <Section title={t("growth.campaigns.spend.title")} id="sp-list">
        {(q.data?.entries.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">{t("growth.campaigns.spend.none")}</p> : <ul className="space-y-1 text-sm" data-testid="spend-rows">{q.data!.entries.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b py-1.5"><span>{e.day} · <span dir="ltr">{money(e.amountMinor, c.currency)}</span></span><span className="text-xs">{t(`growth.campaigns.spend.status.${e.status}`, { defaultValue: e.status })}</span></li>)}</ul>}
      </Section>
      {(q.data?.daily.length ?? 0) > 0 && <Section title={t("growth.campaigns.spend.daily")} id="sp-daily"><ul className="space-y-1 text-sm">{q.data!.daily.map((d) => <li key={d.day} className="flex justify-between"><span>{d.day}</span><span dir="ltr">{money(d.approvedSpendMinor, c.currency)} / {money(d.plannedMinor, c.currency)}</span></li>)}</ul></Section>}
    </div>
  );
}

function CreativesTab({ c, can }: { c: Campaign; can: boolean }) {
  const { t } = useTranslation(); const acts = useCampaignActions(); const errText = useErrorText(); const q = useCampaignCreatives(c.id);
  const [kind, setKind] = useState("IMAGE"); const [ref, setRef] = useState(""); const [locale, setLocale] = useState("ar"); const [err, setErr] = useState("");
  return (
    <div className="space-y-4">
      <Section title={t("growth.campaigns.creatives.title")} hint={t("growth.campaigns.creatives.hint")} id="cr-add">
        <div className="grid gap-3 sm:grid-cols-4"><FormField label={t("growth.campaigns.creatives.kind")}><select className={`${selectCls} w-full`} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="creative-kind">{["IMAGE", "VIDEO", "COPY", "LANDING", "LINK"].map((k) => <option key={k} value={k}>{t(`growth.campaigns.creatives.kinds.${k}`)}</option>)}</select></FormField>
          <FormField label={t("growth.campaigns.creatives.ref")} className="sm:col-span-2"><input className={inputCls} dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={`growth/creatives/${c.market.toLowerCase()}/${c.id}/banner.png`} data-testid="creative-ref" /></FormField>
          <FormField label={t("growth.campaigns.creatives.locale")}><select className={`${selectCls} w-full`} value={locale} onChange={(e) => setLocale(e.target.value)}><option value="ar">ar</option><option value="en">en</option></select></FormField></div>
        <button type="button" className={`${btn} mt-3 bg-primary text-primary-foreground`} disabled={!can || ref.trim().length < 3 || acts.addCreative.isPending} data-testid="creative-add" onClick={() => { setErr(""); acts.addCreative.mutate({ id: c.id, kind, assetRef: ref.trim(), locale }, { onSuccess: () => { toast.success(t("growth.campaigns.creatives.added")); setRef(""); }, onError: (e) => setErr(errText(e)) }); }}>{t("growth.campaigns.creatives.add")}</button>
        {err && <p role="alert" className="mt-2 text-sm text-destructive" data-testid="creative-error">{err}</p>}
      </Section>
      <Section title={t("growth.campaigns.creatives.title")} id="cr-list">{(q.data?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">{t("growth.campaigns.creatives.none")}</p> : <ul className="space-y-1 text-sm" data-testid="creative-rows">{q.data!.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2 border-b py-1.5"><span className="rounded-full bg-muted px-2 text-xs">{t(`growth.campaigns.creatives.kinds.${r.kind}`, { defaultValue: r.kind })}</span><code dir="ltr" className="min-w-0 flex-1 break-all text-xs">{r.assetRef}</code><span className="text-xs">{r.locale}</span></li>)}</ul>}</Section>
    </div>
  );
}

const mk = (v: Masked | null | undefined, f?: (n: number) => string) => (v === null || v === undefined ? "-" : typeof v === "number" ? (f ? f(v) : new Intl.NumberFormat().format(v)) : v);

function ReportTab({ c }: { c: Campaign }) {
  const { t, i18n } = useTranslation(); const money = useMoney(); const r = useCampaignReport(c.id); const nf = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  if (r.isLoading) return <CardSkeleton rows={3} />; if (r.isError || !r.data) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  const d = r.data; const maskedNote = (x: Masked | null | undefined) => (x === "<10" ? t("growth.campaigns.report.masked") : undefined);
  return (
    <div className="space-y-4" data-testid="campaign-report">
      <p className="text-xs text-muted-foreground">{t("growth.campaigns.report.from")} {d.range.from} · {t("growth.campaigns.report.to")} {d.range.to}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="report-kpis">
        <StatCard label={t("growth.campaigns.detail.approvedSpend")} value={money(d.budget.approvedSpendMinor, d.budget.currency)} />
        <StatCard label={t("growth.campaigns.report.cpa")} value={mk(d.kpis.cpa.values.cpaMinor, (n) => money(n, d.budget.currency))} hint={maskedNote(d.kpis.cpa.values.cpaMinor)} />
        <StatCard label={t("growth.campaigns.report.cac")} value={mk(d.kpis.cac.values.cacMinor, (n) => money(n, d.budget.currency))} hint={maskedNote(d.kpis.cac.values.cacMinor)} />
        <StatCard label={t("growth.campaigns.report.roas")} value={mk(d.kpis.roas.values.roas, (n) => nf(n))} hint={maskedNote(d.kpis.roas.values.roas)} />
      </div>
      <Section title={t("growth.campaigns.report.funnel")} id="rp-funnel">
        <ul className="space-y-1 text-sm" data-testid="report-funnel">{d.funnel.map((s) => <li key={s.stage} className="flex justify-between border-b py-1.5" data-stage={s.stage}><span>{t(`growth.campaigns.report.stage.${s.stage}`, { defaultValue: s.stage })}</span><span className="tabular-nums" data-masked={s.masked}>{mk(s.count, nf)}</span></li>)}</ul>
        {d.funnel.some((s) => s.masked) && <p className="mt-2 text-xs text-muted-foreground">{t("growth.campaigns.report.masked")}</p>}
      </Section>
      <Section title={t("growth.campaigns.report.daily")} id="rp-daily">{d.daily.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.campaigns.report.nothing")}</p> : <ul className="space-y-1 text-sm" data-testid="report-daily">{d.daily.map((x) => <li key={x.day} className="flex flex-wrap justify-between gap-2 border-b py-1.5"><span>{x.day}</span><span className="tabular-nums" dir="ltr">{money(x.spendMinor, d.budget.currency)} · {mk(x.pageViews, nf)} · {mk(x.bookingsConfirmed, nf)}</span></li>)}</ul>}</Section>
      <Section title={t("growth.campaigns.report.bySource")} id="rp-source">{d.bySource.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.campaigns.report.nothing")}</p> : <ul className="space-y-1 text-sm">{d.bySource.map((x) => <li key={x.sourceKind} className="flex justify-between border-b py-1.5"><span>{x.sourceKind}</span><span className="tabular-nums">{mk(x.pageViews, nf)} · {mk(x.bookingsConfirmed, nf)}</span></li>)}</ul>}</Section>
      <Section title={t("growth.campaigns.report.revenue")} id="rp-rev"><p className="text-sm" data-testid="report-revenue">{d.revenue.netMinor === null ? "-" : d.revenue.masked ? "<10" : money(d.revenue.netMinor, d.budget.currency)}</p><p className="text-xs text-muted-foreground">{d.revenue.note}</p></Section>
      <Section title={d.external.connected ? t("growth.campaigns.report.connected", { kinds: d.external.kinds.join(", ") }) : t("growth.campaigns.report.notConnected")} id="rp-ext">
        <p className="text-sm" data-testid="report-external" data-connected={d.external.connected}>{d.external.connected ? Object.entries(d.external.metrics).map(([k, v]) => `${k}: ${nf(v)}`).join(" · ") : t("growth.campaigns.report.notConnectedHint")}</p>
      </Section>
    </div>
  );
}

function HistoryTab({ c, lang }: { c: Campaign; lang: string }) {
  const { t } = useTranslation(); const q = useCampaignHistory(c.id);
  const cols: Column<NonNullable<typeof q.data>[number]>[] = [
    { key: "at", header: t("growth.campaigns.history.when"), cell: (h) => formatDateTime(h.at, lang) },
    { key: "change", header: t("growth.campaigns.history.change"), cell: (h) => `${t(`growth.campaigns.status.${h.from}`)} → ${t(`growth.campaigns.status.${h.to}`)}` },
    { key: "reason", header: t("growth.campaigns.approvals.reasonLabel"), cell: (h) => <code dir="ltr">{h.reasonCode}</code> },
    { key: "actor", header: t("growth.campaigns.history.by", { who: "" }), cell: (h) => <code dir="ltr">{h.actor}</code> },
  ];
  return <Section title={t("growth.campaigns.history.title")} id="hi"><div data-testid="campaign-history"><DataTable columns={cols} rows={q.data ?? []} rowKey={(h) => h.id} caption={t("growth.campaigns.history.title")} empty={t("growth.campaigns.history.none")} /></div></Section>;
}
