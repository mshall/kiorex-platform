import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { rawApi } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardSkeleton, ErrorState } from "@/components/states";
import { formatBps, formatDateTime, formatMinor, localToIso } from "@/lib/format";

/** COM-2 commission rates in the ops console: default per organisation type, per-organisation inherit / override, history. Rates are money: maker-checker, enforced by the API. No rate is shipped: "not set" means no charge. */
export type Spec = { feeType: "PERCENT" | "FLAT"; percentBps: number | null; flatMinor: number | null; minMinor: number | null; maxMinor: number | null; mode: string | null; currency?: string | null; rounding?: string | null; minCollectMinor?: number | null; graceDays?: number | null; retryDays?: number[] | null; invoiceDueDays?: number | null; reminderDays?: number[] | null; disputeWindowDays?: number | null; savedMethodChargeAllowed?: boolean | null; tenders?: Partial<Record<TenderKind, Treatment>> };
export type TenderKind = "ONLINE" | "CASH" | "CASH_TRANSFER";
export type Treatment = { feeType?: "PERCENT" | "FLAT"; percentBps?: number | null; flatMinor?: number | null; minMinor?: number | null; maxMinor?: number | null; mode?: string | null; graceDays?: number | null };
const TENDER_KINDS: TenderKind[] = ["ONLINE", "CASH", "CASH_TRANSFER"];
export type Eff = { state: "SET" | "NOT_SET"; source: "OVERRIDE" | "DEFAULT" | null; policyId: string | null; version: number | null; effectiveFrom: string | null; reason: string | null; spec: Spec | null };
export type RateRow = { id: string; scope: string; product: string; scopeRef: string; kind: string; version: number; status: string; spec: Spec | null; effectiveFrom: string; reason: string | null; proposedBy: string; decidedBy: string | null; decisionNote: string | null };
type DefaultCard = { product: string; effective: Eff; pending: RateRow | null; upcoming: RateRow | null; history: RateRow[] };
type OrgView = { orgRef: string; product: string; linked: boolean; state: "SET" | "NOT_SET"; effective: Eff; default: Eff; override: Eff | null; inheriting: boolean; mode: string | null; pending: RateRow | null; upcoming: RateRow | null; history: RateRow[] };
export type RateCaps = { read: boolean; proposeRate?: boolean; approveRate?: boolean };
const B = "/admin/commissions/rates";
const PRODUCTS = ["CLINIC", "PHARMACY", "LAB"] as const;
const MODES = ["NET_FROM_PAYOUT", "AUTO_CHARGE_SAVED_METHOD", "INVOICE_AND_COLLECT"] as const;
const selectCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";

/** One rate in words: "12.5% of the fee, min 5.00, max 90.00" or "40.00 per charge". */
export function RateText({ spec }: { spec: Spec | null }) {
  const { t, i18n } = useTranslation();
  if (!spec) return <Badge variant="warning" data-testid="rate-not-set">{t("commissions.rates.notSet")}</Badge>;
  const base = spec.feeType === "PERCENT" ? t("commissions.rates.percentOf", { pct: formatBps(spec.percentBps ?? 0, i18n.language) }) : t("commissions.rates.flatPer", { amount: formatMinor(spec.flatMinor ?? 0, i18n.language) });
  const bounds = [spec.minMinor != null ? `${t("commissions.rates.min")} ${formatMinor(spec.minMinor, i18n.language)}` : null, spec.maxMinor != null ? `${t("commissions.rates.max")} ${formatMinor(spec.maxMinor, i18n.language)}` : null].filter(Boolean).join(", ");
  const lines = TENDER_KINDS.filter((k) => spec.tenders?.[k]).map((k) => ({ k, tr: spec.tenders![k]! }));
  return <span data-testid="rate-text">{base}{bounds ? ` (${bounds})` : ""}{spec.mode ? ` · ${t(`commissions.modes.${spec.mode}`, { defaultValue: spec.mode })}` : ""}
    {lines.length > 0 && <span className="mt-1 block text-xs text-muted-foreground" data-testid="rate-tenders">{lines.map(({ k, tr }) => <span key={k} className="block" data-testid={`rate-tender-${k}`}>{t(`commissions.rates.tender.${k}`)}: {[tr.feeType ? (tr.feeType === "PERCENT" ? t("commissions.rates.percentOf", { pct: formatBps(tr.percentBps ?? 0, i18n.language) }) : t("commissions.rates.flatPer", { amount: formatMinor(tr.flatMinor ?? 0, i18n.language) })) : t("commissions.rates.tender.sameRate"), tr.minMinor != null ? `${t("commissions.rates.min")} ${formatMinor(tr.minMinor, i18n.language)}` : null, tr.maxMinor != null ? `${t("commissions.rates.max")} ${formatMinor(tr.maxMinor, i18n.language)}` : null, tr.mode ? t(`commissions.modes.${tr.mode}`, { defaultValue: tr.mode }) : null, tr.graceDays != null ? `${t("commissions.rates.form.grace")} ${tr.graceDays}` : null].filter(Boolean).join(" · ")}</span>)}</span>}</span>;
}

function Effective({ e, label, testid }: { e: Eff | null; label: string; testid: string }) {
  const { t, i18n } = useTranslation();
  return <div className="rounded-xl border bg-card p-3" data-testid={testid}>
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="mt-1 text-sm font-semibold">{e && e.state === "SET" ? <RateText spec={e.spec} /> : <RateText spec={null} />}</div>
    {e && e.state === "SET" && <div className="mt-1 text-xs text-muted-foreground">{t(`commissions.rates.source.${e.source}`)} · v{e.version} · {formatDateTime(e.effectiveFrom, i18n.language)}{e.reason ? ` · ${e.reason}` : ""}</div>}
    {(!e || e.state === "NOT_SET") && <div className="mt-1 text-xs text-muted-foreground">{t("commissions.rates.notSetHint")}</div>}
  </div>;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));
const list = (v: string) => (v.trim() === "" ? null : v.split(",").map((x) => Number(x.trim())));
const toMinor = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));

/** The proposal form. Percent is typed as a percentage, money in major units; the API receives basis points and minor units. */
function RateForm({ onSubmit, busy, withReason, testid }: { onSubmit: (b: { spec: Record<string, unknown>; effectiveFrom?: string; reason: string }) => void; busy: boolean; withReason: boolean; testid: string }) {
  const { t } = useTranslation();
  const [feeType, setFeeType] = useState<"PERCENT" | "FLAT">("PERCENT");
  const [pct, setPct] = useState(""); const [flat, setFlat] = useState(""); const [min, setMin] = useState(""); const [max, setMax] = useState("");
  const [cur, setCur] = useState(""); const [rnd, setRnd] = useState(""); const [minC, setMinC] = useState(""); const [grace, setGrace] = useState(""); const [retry, setRetry] = useState(""); const [due, setDue] = useState(""); const [rem, setRem] = useState(""); const [dw, setDw] = useState(""); const [tok, setTok] = useState("");
  const [mode, setMode] = useState(""); const [from, setFrom] = useState(""); const [reason, setReason] = useState("");
  // LG-COM-20: per payment kind treatment; every field left empty inherits the base rate above
  const emptyT = { fee: "", pct: "", flat: "", min: "", max: "", mode: "", grace: "" };
  const [tn, setTn] = useState<Record<TenderKind, typeof emptyT>>({ ONLINE: emptyT, CASH: emptyT, CASH_TRANSFER: emptyT });
  const setT = (k: TenderKind, patch: Partial<typeof emptyT>) => setTn((x) => ({ ...x, [k]: { ...x[k], ...patch } }));
  const tendersOut = () => { const out: Record<string, Record<string, unknown>> = {}; for (const k of TENDER_KINDS) { const v = tn[k]; const e: Record<string, unknown> = {}; if (v.fee === "PERCENT") { e.feeType = "PERCENT"; e.percentBps = Math.round((num(v.pct) ?? 0) * 100); } else if (v.fee === "FLAT") { e.feeType = "FLAT"; e.flatMinor = toMinor(v.flat) ?? 0; } if (v.min.trim()) e.minMinor = toMinor(v.min); if (v.max.trim()) e.maxMinor = toMinor(v.max); if (v.mode) e.mode = v.mode; if (v.grace.trim()) e.graceDays = num(v.grace); if (Object.keys(e).length) out[k] = e; } return Object.keys(out).length ? out : undefined; };
  const valid = (feeType === "PERCENT" ? pct.trim() !== "" && Number(pct) >= 0 && Number(pct) <= 100 : flat.trim() !== "" && Number(flat) >= 0) && (!withReason || reason.trim().length > 0);
  const submit = () => onSubmit({ spec: { feeType, ...(feeType === "PERCENT" ? { percentBps: Math.round((num(pct) ?? 0) * 100) } : { flatMinor: toMinor(flat) }), minMinor: toMinor(min), maxMinor: toMinor(max), mode: mode || null, currency: cur.trim().toUpperCase() || null, rounding: rnd || null, minCollectMinor: toMinor(minC), graceDays: num(grace), retryDays: list(retry), invoiceDueDays: num(due), reminderDays: list(rem), disputeWindowDays: num(dw), savedMethodChargeAllowed: tok === "" ? null : tok === "yes", ...(tendersOut() ? { tenders: tendersOut() } : {}) }, effectiveFrom: localToIso(from), reason });
  const f = "grid min-w-0 gap-1 text-sm";
  return <form data-testid={testid} onSubmit={(e) => { e.preventDefault(); if (valid) submit(); }} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <label className={f}>{t("commissions.rates.form.feeType")}<select className={selectCls} value={feeType} onChange={(e) => setFeeType(e.target.value as "PERCENT" | "FLAT")} data-testid="rate-feetype"><option value="PERCENT">{t("commissions.rates.form.percent")}</option><option value="FLAT">{t("commissions.rates.form.flat")}</option></select></label>
    {feeType === "PERCENT"
      ? <label className={f}>{t("commissions.rates.form.pct")}<Input dir="ltr" inputMode="decimal" type="number" step="0.01" min="0" max="100" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="rate-pct" /></label>
      : <label className={f}>{t("commissions.rates.form.flatAmount")}<Input dir="ltr" inputMode="decimal" type="number" step="0.01" min="0" value={flat} onChange={(e) => setFlat(e.target.value)} data-testid="rate-flat" /></label>}
    <label className={f}>{t("commissions.rates.form.min")}<Input dir="ltr" inputMode="decimal" type="number" step="0.01" min="0" value={min} onChange={(e) => setMin(e.target.value)} /></label>
    <label className={f}>{t("commissions.rates.form.max")}<Input dir="ltr" inputMode="decimal" type="number" step="0.01" min="0" value={max} onChange={(e) => setMax(e.target.value)} /></label>
    <label className={f}>{t("commissions.rates.form.mode")}<select className={selectCls} value={mode} onChange={(e) => setMode(e.target.value)} data-testid="rate-mode"><option value="">{t("commissions.rates.form.followSettings")}</option>{MODES.map((m) => <option key={m} value={m}>{t(`commissions.modes.${m}`)}</option>)}</select></label>
    <label className={f}>{t("commissions.rates.form.effectiveFrom")}<Input type="datetime-local" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="rate-from" /></label>
    <fieldset className="grid grid-cols-1 gap-3 rounded-xl border p-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-3" data-testid="rate-extra"><legend className="px-1 text-sm font-semibold">{t("commissions.rates.form.extra")}</legend>
      <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">{t("commissions.rates.form.extraHint")}</p>
      <label className={f}>{t("commissions.rates.form.currency")}<Input dir="ltr" maxLength={3} value={cur} onChange={(e) => setCur(e.target.value)} data-testid="rate-currency" /></label>
      <label className={f}>{t("commissions.rates.form.rounding")}<select className={selectCls} value={rnd} onChange={(e) => setRnd(e.target.value)}><option value="">{t("commissions.rates.form.followSettings")}</option>{["HALF_UP", "DOWN", "UP"].map((m) => <option key={m} value={m}>{t(`commissions.rates.rounding.${m}`)}</option>)}</select></label>
      <label className={f}>{t("commissions.rates.form.minCollect")}<Input dir="ltr" inputMode="decimal" type="number" step="0.01" min="0" value={minC} onChange={(e) => setMinC(e.target.value)} /></label>
      <label className={f}>{t("commissions.rates.form.grace")}<Input dir="ltr" type="number" min="0" max="30" value={grace} onChange={(e) => setGrace(e.target.value)} /></label>
      <label className={f}>{t("commissions.rates.form.retry")}<Input dir="ltr" placeholder="2, 5" value={retry} onChange={(e) => setRetry(e.target.value)} /></label>
      <label className={f}>{t("commissions.rates.form.due")}<Input dir="ltr" type="number" min="1" max="90" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <label className={f}>{t("commissions.rates.form.reminders")}<Input dir="ltr" placeholder="-3, 0, 7" value={rem} onChange={(e) => setRem(e.target.value)} /></label>
      <label className={f}>{t("commissions.rates.form.disputeWindow")}<Input dir="ltr" type="number" min="0" max="365" value={dw} onChange={(e) => setDw(e.target.value)} /></label>
      <label className={f}>{t("commissions.rates.form.token")}<select className={selectCls} value={tok} onChange={(e) => setTok(e.target.value)}><option value="">{t("commissions.rates.form.followSettings")}</option><option value="yes">{t("commissions.rates.form.tokenYes")}</option><option value="no">{t("commissions.rates.form.tokenNo")}</option></select></label>
    </fieldset>
    <fieldset className="grid grid-cols-1 gap-3 rounded-xl border p-3 sm:col-span-2 lg:col-span-3" data-testid="rate-tenders-form"><legend className="px-1 text-sm font-semibold">{t("commissions.rates.tender.title")}</legend>
      <p className="text-xs text-muted-foreground">{t("commissions.rates.tender.hint")}</p>
      {TENDER_KINDS.map((k) => <div key={k} className="grid grid-cols-2 gap-2 rounded-lg border p-2 lg:grid-cols-6" data-testid={`tender-row-${k}`}>
        <div className="col-span-2 text-sm font-semibold lg:col-span-6">{t(`commissions.rates.tender.${k}`)}</div>
        <label className={f}>{t("commissions.rates.form.feeType")}<select className={selectCls} value={tn[k].fee} onChange={(e) => setT(k, { fee: e.target.value })} data-testid={`tender-fee-${k}`}><option value="">{t("commissions.rates.tender.sameRate")}</option><option value="PERCENT">{t("commissions.rates.form.percent")}</option><option value="FLAT">{t("commissions.rates.form.flat")}</option></select></label>
        {tn[k].fee === "PERCENT" && <label className={f}>{t("commissions.rates.form.pct")}<Input dir="ltr" inputMode="decimal" type="number" step="0.01" min="0" max="100" value={tn[k].pct} onChange={(e) => setT(k, { pct: e.target.value })} data-testid={`tender-pct-${k}`} /></label>}
        {tn[k].fee === "FLAT" && <label className={f}>{t("commissions.rates.form.flatAmount")}<Input dir="ltr" inputMode="decimal" type="number" step="0.01" min="0" value={tn[k].flat} onChange={(e) => setT(k, { flat: e.target.value })} data-testid={`tender-flat-${k}`} /></label>}
        <label className={f}>{t("commissions.rates.form.min")}<Input dir="ltr" inputMode="decimal" type="number" step="0.01" min="0" value={tn[k].min} onChange={(e) => setT(k, { min: e.target.value })} /></label>
        <label className={f}>{t("commissions.rates.form.max")}<Input dir="ltr" inputMode="decimal" type="number" step="0.01" min="0" value={tn[k].max} onChange={(e) => setT(k, { max: e.target.value })} /></label>
        <label className={f}>{t("commissions.rates.form.mode")}<select className={selectCls} value={tn[k].mode} onChange={(e) => setT(k, { mode: e.target.value })}><option value="">{t("commissions.rates.tender.sameRate")}</option>{MODES.map((m) => <option key={m} value={m}>{t(`commissions.modes.${m}`)}</option>)}</select></label>
        <label className={f}>{t("commissions.rates.form.grace")}<Input dir="ltr" type="number" min="0" max="30" value={tn[k].grace} onChange={(e) => setT(k, { grace: e.target.value })} /></label>
      </div>)}
    </fieldset>
    <label className={`${f} sm:col-span-2 lg:col-span-3`}>{withReason ? t("commissions.rates.form.reason") : t("commissions.rates.form.note")}<Input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rate-reason" required={withReason} /></label>
    <div className="sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={!valid || busy} data-testid="rate-submit">{t("commissions.rates.form.propose")}</Button> <span className="ms-2 text-xs text-muted-foreground">{t("commissions.rates.form.makerChecker")}</span></div>
  </form>;
}

function HistoryTable({ rows, caps, onDecide }: { rows: RateRow[]; caps: RateCaps; onDecide: (id: string, approve: boolean) => void }) {
  const { t, i18n } = useTranslation();
  if (!rows.length) return <p className="mt-2 text-sm text-muted-foreground" data-testid="rate-history-empty">{t("commissions.rates.noHistory")}</p>;
  return <div className="mt-2 max-w-full overflow-x-auto" data-testid="rate-history" tabIndex={0} role="region" aria-label={t("commissions.rates.history")}><table className="w-full min-w-[34rem] text-start text-sm"><caption className="sr-only">{t("commissions.rates.history")}</caption>
    <thead><tr className="text-xs text-muted-foreground"><th scope="col" className="p-2 text-start">{t("commissions.col.version")}</th><th scope="col" className="p-2 text-start">{t("commissions.rates.rate")}</th><th scope="col" className="p-2 text-start">{t("commissions.rates.effectiveFrom")}</th><th scope="col" className="p-2 text-start">{t("commissions.col.status")}</th><th scope="col" className="p-2 text-start">{t("commissions.col.proposedBy")}</th><th scope="col" className="p-2 text-start">{t("commissions.rates.form.reason")}</th><th scope="col" className="p-2" /></tr></thead>
    <tbody>{rows.map((r) => <tr key={r.id} className="border-t">
      <td className="p-2" dir="ltr">v{r.version}</td>
      <td className="p-2">{r.kind === "INHERIT" ? t("commissions.rates.backToDefault") : <RateText spec={r.spec} />}</td>
      <td className="p-2">{formatDateTime(r.effectiveFrom, i18n.language)}</td>
      <td className="p-2"><Badge variant={r.status === "ACTIVE" ? "success" : r.status === "PENDING" ? "warning" : "secondary"}>{t(`commissions.status.${r.status}`, { defaultValue: r.status })}</Badge></td>
      <td className="p-2" dir="ltr">{r.proposedBy}</td>
      <td className="p-2">{r.reason ?? "-"}</td>
      <td className="p-2">{r.status === "PENDING" && caps.approveRate && <span className="flex gap-1"><Button size="sm" onClick={() => onDecide(r.id, true)} data-testid="rate-approve">{t("commissions.rates.approve")}</Button><Button size="sm" variant="outline" onClick={() => onDecide(r.id, false)} data-testid="rate-reject">{t("commissions.rates.reject")}</Button></span>}</td>
    </tr>)}</tbody></table></div>;
}

function useDecide(invalidate: () => void) {
  const { t } = useTranslation();
  return useMutation({ mutationFn: (v: { id: string; approve: boolean }) => rawApi("POST", `${B}/${v.id}/decide`, { approve: v.approve }), onSuccess: () => { toast.success(t("commissions.rates.toast.decided")); invalidate(); }, onError: () => toast.error(t("commissions.rates.toast.forbidden")) });
}

/** Tab "Default rates": one card per organisation type. */
export function RatesTab({ caps }: { caps: RateCaps }) {
  const { t } = useTranslation(); const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["com", "rates", "defaults"], queryFn: () => rawApi<DefaultCard[]>("GET", `${B}/defaults`) });
  const inv = () => void qc.invalidateQueries({ queryKey: ["com"] });
  const decide = useDecide(inv);
  const propose = useMutation({ mutationFn: (v: { product: string; spec: Record<string, unknown>; effectiveFrom?: string; note?: string }) => rawApi("POST", `${B}/defaults`, v), onSuccess: () => { toast.success(t("commissions.rates.toast.proposed")); setOpen(null); inv(); }, onError: () => toast.error(t("commissions.toast.error")) });
  if (q.isLoading) return <CardSkeleton rows={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <div data-testid="rates-defaults"><p className="mb-3 text-sm text-muted-foreground">{t("commissions.rates.defaultsHint")} <Link to="/commission-policy" className="font-semibold underline" data-testid="rates-policy-link">{t("commissions.policy.link")}</Link></p>
    <div className="grid gap-4 lg:grid-cols-3">{q.data.map((c) => <section key={c.product} className="min-w-0 rounded-xl border bg-card p-4 shadow-card" data-testid={`rates-card-${c.product}`} aria-label={t(`commissions.rates.product.${c.product}`)}>
      <h2 className="text-base font-semibold">{t(`commissions.rates.product.${c.product}`)}</h2>
      <div className="mt-2"><Effective e={c.effective} label={t("commissions.rates.defaultNow")} testid={`rates-eff-${c.product}`} /></div>
      {c.upcoming && <p className="mt-2 text-sm" data-testid={`rates-upcoming-${c.product}`}>{t("commissions.rates.upcoming")}: <RateText spec={c.upcoming.spec} /> · {formatDateTime(c.upcoming.effectiveFrom, "en")}</p>}
      {caps.proposeRate && !c.pending && <Button size="sm" variant="outline" className="mt-3" onClick={() => setOpen(open === c.product ? null : c.product)} data-testid={`rates-open-${c.product}`}>{t("commissions.rates.change")}</Button>}
      {c.pending && <p className="mt-2 text-sm" data-testid={`rates-pending-${c.product}`}><Badge variant="warning">{t("commissions.status.PENDING")}</Badge> <RateText spec={c.pending.spec} /></p>}
      {open === c.product && <RateForm testid={`rates-form-${c.product}`} withReason={false} busy={propose.isPending} onSubmit={(b) => propose.mutate({ product: c.product, spec: b.spec, effectiveFrom: b.effectiveFrom, note: b.reason || undefined })} />}
      <h3 className="mt-4 text-sm font-semibold">{t("commissions.rates.history")}</h3>
      <HistoryTable rows={c.history} caps={caps} onDecide={(id, approve) => decide.mutate({ id, approve })} />
    </section>)}</div></div>;
}

/** Per-organisation rate panel: default and override side by side, the effective rate, inherit / override toggle, history. */
export function OrgRatePanel({ org, caps }: { org: string; caps: RateCaps }) {
  const { t } = useTranslation(); const qc = useQueryClient();
  const [product, setProduct] = useState<string>("CLINIC"); const [mode, setMode] = useState<"inherit" | "override" | null>(null); const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["com", "rates", "org", org, product], queryFn: () => rawApi<OrgView>("GET", `${B}/orgs/${encodeURIComponent(org)}?product=${product}`) });
  const inv = () => void qc.invalidateQueries({ queryKey: ["com"] });
  const decide = useDecide(inv);
  const send = useMutation({ mutationFn: (v: Record<string, unknown>) => rawApi("POST", `${B}/orgs/${encodeURIComponent(org)}`, { product, ...v }), onSuccess: () => { toast.success(t("commissions.rates.toast.proposed")); setMode(null); setReason(""); inv(); }, onError: () => toast.error(t("commissions.toast.error")) });
  if (q.isLoading) return <CardSkeleton rows={2} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const v = q.data;
  return <section className="mt-6 min-w-0 rounded-xl border bg-card p-4" data-testid="rates-org-panel" aria-label={t("commissions.rates.orgTitle")}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">{t("commissions.rates.orgTitle")} <span dir="ltr" className="text-muted-foreground">{org}</span></h2>
      {!v.linked && <label className="flex items-center gap-2 text-sm">{t("commissions.rates.productOf")}<select className={`${selectCls} w-auto`} value={product} onChange={(e) => setProduct(e.target.value)} data-testid="rates-org-product">{PRODUCTS.map((p) => <option key={p} value={p}>{t(`commissions.rates.product.${p}`)}</option>)}</select></label>}</div>
    <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-3">
      <Effective e={v.effective} label={t("commissions.rates.effective")} testid="rates-org-effective" />
      <Effective e={v.default} label={t("commissions.rates.default")} testid="rates-org-default" />
      <div className="rounded-xl border bg-card p-3" data-testid="rates-org-override"><div className="text-xs text-muted-foreground">{t("commissions.rates.override")}</div>
        <div className="mt-1 text-sm font-semibold">{v.override ? <RateText spec={v.override.spec} /> : t("commissions.rates.inheriting")}</div>
        {v.override?.reason && <div className="mt-1 text-xs text-muted-foreground">{v.override.reason}</div>}</div>
    </div>
    {v.pending && <p className="mt-3 text-sm" data-testid="rates-org-pending"><Badge variant="warning">{t("commissions.status.PENDING")}</Badge> {v.pending.kind === "INHERIT" ? t("commissions.rates.backToDefault") : <RateText spec={v.pending.spec} />}</p>}
    {caps.proposeRate && !v.pending && <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("commissions.rates.toggle")}>
      <Button size="sm" variant={mode === "inherit" || (mode === null && v.inheriting) ? "secondary" : "outline"} aria-pressed={v.inheriting} onClick={() => setMode("inherit")} disabled={v.inheriting} data-testid="rates-toggle-inherit">{t("commissions.rates.useDefault")}</Button>
      <Button size="sm" variant={mode === "override" ? "secondary" : "outline"} aria-pressed={!v.inheriting} onClick={() => setMode("override")} data-testid="rates-toggle-override">{v.inheriting ? t("commissions.rates.customize") : t("commissions.rates.changeOverride")}</Button>
    </div>}
    {mode === "inherit" && <div className="mt-3 grid gap-2 sm:max-w-md"><label className="grid gap-1 text-sm">{t("commissions.rates.form.reason")}<Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="rates-inherit-reason" /></label>
      <Button size="sm" disabled={!reason.trim() || send.isPending} onClick={() => send.mutate({ kind: "INHERIT", reason })} data-testid="rates-inherit-submit">{t("commissions.rates.form.propose")}</Button></div>}
    {mode === "override" && <RateForm testid="rates-org-form" withReason busy={send.isPending} onSubmit={(b) => send.mutate({ kind: "RATE", spec: b.spec, effectiveFrom: b.effectiveFrom, reason: b.reason })} />}
    <h3 className="mt-4 text-sm font-semibold">{t("commissions.rates.history")}</h3>
    <HistoryTable rows={v.history} caps={caps} onDecide={(id, approve) => decide.mutate({ id, approve })} />
  </section>;
}

export type { ReactElement };
