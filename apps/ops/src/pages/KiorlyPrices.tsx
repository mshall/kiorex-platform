import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardSkeleton, ErrorState } from "@/components/states";
import { StatusChip } from "@/components/kit";
import { useDecideProposal, usePlansOverview, usePreviewPrice, useProposePrice, type ClinicMarket, type PriceCheck, type PriceProduct, type PriceProposal, type PriceWarning, type ProductPrice } from "@/api/kiorlyPlans";
import { emptyProposalForm, formatWhen, priceState, proposalActions, toProposalBody, validateProposal, type ProposalForm } from "@/lib/kiorlyPlansLogic";
import { errorCode } from "@/lib/kiorlyMarketsLogic";

const selectCls = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";
const num = { dir: "ltr" as const };

function useErrText() {
  const { t } = useTranslation();
  return (e: unknown): string => {
    const code = errorCode(e);
    if (code) { const s = t(`kiorlyPrices.errors.${code}`, { defaultValue: "" }) || t(`kiorlyPlans.errors.${code}`, { defaultValue: "" }); if (s) return s; }
    return t("kiorlyPrices.errors.generic");
  };
}

export function Warnings({ list, testid = "price-warnings" }: { list: PriceWarning[]; testid?: string }) {
  const { t } = useTranslation();
  if (!list.length) return null;
  return (
    <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm" role="status" data-testid={testid}>
      <p className="font-semibold">{t("kiorlyPrices.warn.title")}</p>
      <ul className="ms-4 list-disc">{list.map((w, i) => <li key={`${w.code}${i}`} data-code={w.code}>{t(`kiorlyPrices.warn.${w.code}`, { ...w.params, defaultValue: w.code })}</li>)}</ul>
      <p className="mt-1 text-xs text-muted-foreground">{t("kiorlyPrices.warn.advisory")}</p>
    </div>
  );
}

export function ProposeDialog({ product, planRef, planLabel, markets, onClose, onDone }: { product: PriceProduct; planRef: string; planLabel: string; markets: ClinicMarket[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(); const errText = useErrText(); const check = usePreviewPrice(); const propose = useProposePrice();
  const [f, setF] = useState<ProposalForm>(emptyProposalForm(product, planRef, markets[0]));
  const [touched, setTouched] = useState(false); const [err, setErr] = useState<string | null>(null); const [pv, setPv] = useState<PriceCheck | null>(null);
  const bad = validateProposal(f); const busy = check.isPending || propose.isPending;
  const set = (patch: Partial<ProposalForm>) => { setF({ ...f, ...patch }); setPv(null); };
  const fe = (k: keyof typeof bad) => (touched && bad[k] ? <p className="text-xs text-destructive" role="alert">{t(`kiorlyPrices.field.${k}`)}</p> : null);
  const valid = () => { setTouched(true); return Object.keys(validateProposal(f)).length === 0; };
  const runPreview = () => { if (busy || !valid()) return; setErr(null); check.mutate(toProposalBody(f), { onSuccess: setPv, onError: (e) => setErr(errText(e)) }); };
  const submit = () => { if (busy || !pv || !valid()) return; setErr(null); propose.mutate(toProposalBody(f), { onSuccess: onDone, onError: (e) => setErr(errText(e)) }); };
  const impact = pv?.preview;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-xl" data-testid="propose-dialog">
        <DialogHeader><DialogTitle>{t("kiorlyPrices.propose.title")}: {t(`kiorlyPrices.product.${product}`)} · {planLabel}</DialogTitle><DialogDescription>{t("kiorlyPrices.propose.intro")}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="pr-market">{t("kiorlyPrices.market")}</Label>
              {product === "CLINIC" ? (
                <select id="pr-market" className={selectCls} value={f.marketCode} onChange={(e) => { const m = markets.find((x) => x.code === e.target.value); set({ marketCode: e.target.value, currency: m?.defaultCurrency ?? f.currency }); }}>
                  {markets.map((m) => <option key={m.id} value={m.code}>{m.code} - {m.nameEn}</option>)}
                </select>
              ) : <Input id="pr-market" {...num} maxLength={2} value={f.marketCode} onChange={(e) => { const code = e.target.value.toUpperCase(); const m = markets.find((x) => x.code === code); set({ marketCode: code, ...(m ? { currency: m.defaultCurrency } : {}) }); }} />}
              {fe("market")}</div>
            <div><Label htmlFor="pr-cur">{t("kiorlyPrices.currency")}</Label><Input id="pr-cur" {...num} maxLength={3} value={f.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />{fe("currency")}</div>
            <div><Label htmlFor="pr-int">{t("kiorlyPrices.interval")}</Label><select id="pr-int" className={selectCls} value={f.interval} onChange={(e) => set({ interval: e.target.value as ProposalForm["interval"] })}><option value="MONTHLY">{t("kiorlyPlans.clinic.interval.MONTHLY")}</option><option value="ANNUAL">{t("kiorlyPlans.clinic.interval.ANNUAL")}</option></select></div>
            {product === "CLINIC" ? <div><Label htmlFor="pr-unit">{t("kiorlyPrices.unit")}</Label><select id="pr-unit" className={selectCls} value={f.unit} onChange={(e) => set({ unit: e.target.value as ProposalForm["unit"] })}><option value="PER_TENANT">{t("kiorlyPlans.clinic.unit.PER_TENANT")}</option><option value="PER_CLINICIAN">{t("kiorlyPlans.clinic.unit.PER_CLINICIAN")}</option></select></div> : null}
            <div><Label htmlFor="pr-amount">{t("kiorlyPrices.amount")}</Label><Input id="pr-amount" {...num} inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} />{fe("amount")}</div>
            {product === "CLINIC" ? <>
              <div><Label htmlFor="pr-inc">{t("kiorlyPrices.included")}</Label><Input id="pr-inc" {...num} inputMode="numeric" value={f.includedClinicians} onChange={(e) => set({ includedClinicians: e.target.value })} />{fe("included")}</div>
              <div><Label htmlFor="pr-extra">{t("kiorlyPrices.extra")}</Label><Input id="pr-extra" {...num} inputMode="decimal" value={f.extraClinicianAmount} onChange={(e) => set({ extraClinicianAmount: e.target.value })} />{fe("extra")}</div>
            </> : null}
            <div><Label htmlFor="pr-from">{t("kiorlyPrices.validFrom")}</Label><Input id="pr-from" {...num} type="datetime-local" value={f.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />{fe("validFrom")}</div>
          </div>
          <div><Label htmlFor="pr-note">{t("kiorlyPrices.note")}</Label><Input id="pr-note" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          {impact ? (
            <div className="rounded-md bg-muted px-3 py-2 text-sm" role="status" data-testid="price-preview">
              <b>{t("kiorlyPrices.preview.title")}</b>: {impact.affected > 0 ? t(product === "CLINIC" ? "kiorlyPrices.preview.clinic" : "kiorlyPrices.preview.product", { count: impact.affected, delta: impact.mrrDelta ?? "-" }) : t("kiorlyPrices.preview.none")}
              {" "}{t("kiorlyPrices.preview.version", { version: impact.priceVersion })}{impact.from ? ` ${t("kiorlyPrices.preview.replaces", { amount: impact.from.amount, currency: impact.from.currency })}` : ""}
            </div>
          ) : <p className="text-xs text-muted-foreground">{t("kiorlyPrices.propose.confirm")}</p>}
          {pv ? <Warnings list={pv.warnings} /> : null}
          {err ? <p role="alert" className="text-sm text-destructive" data-testid="propose-error">{err}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{t("kiorlyPrices.cancel")}</Button>
            <Button variant="outline" onClick={runPreview} disabled={busy} data-testid="propose-preview">{t("kiorlyPrices.preview.button")}</Button>
            <Button onClick={submit} disabled={busy || !pv} data-testid="propose-submit">{propose.isPending ? t("kiorlyPrices.working") : t("kiorlyPrices.propose.submit")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", WITHDRAWN: "neutral" };

function DecideDialog({ p, action, onClose, onDone }: { p: PriceProposal; action: "approve" | "reject"; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(); const errText = useErrText(); const mut = useDecideProposal();
  const [note, setNote] = useState(""); const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !mut.isPending) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="decide-dialog">
        <DialogHeader><DialogTitle>{t(`kiorlyPrices.decide.${action}Title`)}</DialogTitle><DialogDescription>{t(`kiorlyPrices.decide.${action}Body`, { product: t(`kiorlyPrices.product.${p.product}`), plan: p.planKey, amount: p.amount, currency: p.currency })}</DialogDescription></DialogHeader>
        <Warnings list={p.warnings} testid="decide-warnings" />
        <div><Label htmlFor="dec-note">{t("kiorlyPrices.decide.note")}</Label><Input id="dec-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {err ? <p role="alert" className="text-sm text-destructive" data-testid="decide-error">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>{t("kiorlyPrices.cancel")}</Button>
          <Button variant={action === "reject" ? "destructive" : "default"} disabled={mut.isPending} data-testid="decide-confirm" onClick={() => { setErr(null); mut.mutate({ id: p.id, action, note: note.trim() || undefined }, { onSuccess: onDone, onError: (e) => setErr(errText(e)) }); }}>{mut.isPending ? t("kiorlyPrices.working") : t(`kiorlyPrices.decide.${action}Button`)}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pharmacy or Lab: every edition with its price versions (the product owns them) and the way to propose one. */
export function ProductPricesSection({ product, markets }: { product: "PHARMACY" | "LAB"; markets: ClinicMarket[] }) {
  const { t, i18n } = useTranslation(); const q = usePlansOverview(); const [dlg, setDlg] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null);
  const d = product === "PHARMACY" ? q.data?.pharmacy : q.data?.lab; const caps = q.data?.capabilities;
  const id = product.toLowerCase();
  return (
    <section className="mb-10" aria-labelledby={`kp-${id}-prices`} data-testid={`${id}-prices`}>
      <h2 id={`kp-${id}-prices`} className="text-lg font-semibold">{t(`kiorlyPrices.section.${id}`)}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t("kiorlyPrices.section.productIntro")}</p>
      {note ? <p role="status" className="mb-3 text-sm text-success" data-testid={`${id}-note`}>{note}</p> : null}
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !d?.available ? <p className="rounded-md bg-muted px-3 py-2 text-sm" role="alert" data-testid={`${id}-unavailable`}>{t(d?.configured === false ? "kiorlyPrices.section.notConfigured" : "kiorlyPrices.section.unavailable", { product: t(`kiorlyPrices.product.${product}`) })}</p> : (
        <div className="grid gap-4">
          {d.editions.map((ed) => {
            const rows = d.prices.filter((x) => x.edition === ed); const orgs = d.organisations.filter((x) => x.edition === ed);
            return (
              <article key={ed} className="rounded-xl border bg-card p-4 shadow-card" data-testid={`${id}-plan-${ed}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{ed} <span className="ms-2 text-xs font-normal text-muted-foreground">{orgs.length ? t("kiorlyPrices.section.orgs", { count: orgs.reduce((a, b) => a + b.count, 0) }) : t("kiorlyPrices.section.noOrgs")}</span></h3>
                  {caps?.canPropose ? <Button size="sm" onClick={() => setDlg(ed)} data-testid={`propose-${id}-${ed}`}>{t("kiorlyPrices.propose.button")}</Button> : null}
                </div>
                {ed === "LITE" ? <p className="mt-1 text-xs text-muted-foreground">{t("kiorlyPrices.section.liteNote")}</p> : null}
                {rows.length === 0 ? <p className="mt-3 text-sm text-muted-foreground" data-testid={`${id}-no-price-${ed}`}>{t("kiorlyPlans.clinic.noPrices")}</p> : (
                  <div className="relative mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="bg-muted/60"><tr>{["market", "interval", "amount", "version", "from", "to", "state"].map((k) => <th key={k} className="px-2 py-1.5 text-start">{t(`kiorlyPlans.clinic.col.${k}`)}</th>)}</tr></thead>
                    <tbody>{rows.map((r: ProductPrice) => { const st = priceState(r); return (
                      <tr key={r.id} className="border-t" data-testid={`${id}-price-${ed}-${r.marketCode}-${r.interval}-${r.priceVersion}`}>
                        <td className="px-2 py-1.5 font-mono" dir="ltr">{r.marketCode}</td><td className="px-2 py-1.5">{t(`kiorlyPlans.clinic.interval.${r.interval}`)}</td>
                        <td className="px-2 py-1.5 font-mono" dir="ltr">{r.amount} {r.currency}</td><td className="px-2 py-1.5">{r.priceVersion}</td>
                        <td className="px-2 py-1.5 text-xs" dir="ltr">{formatWhen(r.validFrom, i18n.language)}</td><td className="px-2 py-1.5 text-xs" dir="ltr">{r.validTo ? formatWhen(r.validTo, i18n.language) : "-"}</td>
                        <td className="px-2 py-1.5"><StatusChip tone={st === "active" ? "success" : st === "scheduled" ? "info" : "neutral"}>{t(`kiorlyPlans.clinic.state.${st}`)}</StatusChip></td>
                      </tr>); })}</tbody></table></div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {dlg ? <ProposeDialog product={product} planRef={dlg} planLabel={dlg} markets={markets} onClose={() => setDlg(null)} onDone={() => { setDlg(null); setNote(t("kiorlyPrices.proposed")); }} /> : null}
    </section>
  );
}

const FILTERS = ["ALL", "PENDING", "APPROVED", "REJECTED", "WITHDRAWN"] as const;

export function ProposalsSection() {
  const { t, i18n } = useTranslation(); const q = usePlansOverview(); const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [dec, setDec] = useState<{ p: PriceProposal; action: "approve" | "reject" } | null>(null); const [msg, setMsg] = useState<string | null>(null); const withdraw = useDecideProposal(); const errText = useErrText(); const [err, setErr] = useState<string | null>(null);
  const caps = q.data?.capabilities; const all = q.data?.proposals ?? []; const list = all.filter((p) => filter === "ALL" || p.status === filter);
  if (q.isLoading) return null;
  return (
    <section className="mb-10" aria-labelledby="kp-proposals" data-testid="proposals-section">
      <h2 id="kp-proposals" className="text-lg font-semibold">{t("kiorlyPrices.proposals.title")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t("kiorlyPrices.proposals.intro")}</p>
      {q.data?.catalogueWarnings?.length ? <div className="mb-3" data-testid="catalogue-warnings"><Warnings list={q.data.catalogueWarnings.map((w) => ({ code: w.code, params: { ...w.params, plan: `${t(`kiorlyPrices.product.${w.product}`)} ${w.planKey}`, market: w.market } }))} testid="catalogue-warnings-list" /></div> : null}
      <div role="tablist" className="mb-3 flex flex-wrap gap-2">{FILTERS.map((f) => <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} data-testid={`filter-${f}`} className={`rounded-lg border px-3 py-1.5 text-sm ${filter === f ? "bg-accent font-semibold" : ""}`}>{t(`kiorlyPrices.proposals.filter.${f}`)}</button>)}</div>
      {msg ? <p role="status" className="mb-2 text-sm text-success" data-testid="proposals-msg">{msg}</p> : null}
      {err ? <p role="alert" className="mb-2 text-sm text-destructive" data-testid="proposals-error">{err}</p> : null}
      {list.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="proposals-empty">{t("kiorlyPrices.proposals.empty")}</p> : (
        <div className="relative overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="bg-muted/60"><tr>{["product", "plan", "market", "interval", "amount", "starts", "by", "status", "actions"].map((k) => <th key={k} className="px-2 py-1.5 text-start">{k === "actions" ? <span className="sr-only">{t("kiorlyPrices.proposals.col.actions")}</span> : t(`kiorlyPrices.proposals.col.${k}`)}</th>)}</tr></thead>
          <tbody>{list.map((p) => { const a = proposalActions(p, caps); return (
            <tr key={p.id} className="border-t align-top" data-testid={`proposal-${p.id}`}>
              <td className="px-2 py-1.5">{t(`kiorlyPrices.product.${p.product}`)}</td><td className="px-2 py-1.5">{p.planKey}{p.product === "CLINIC" ? ` (${t(`kiorlyPlans.clinic.unit.${p.unit}`)})` : ""}</td>
              <td className="px-2 py-1.5 font-mono" dir="ltr">{p.marketCode}</td><td className="px-2 py-1.5">{t(`kiorlyPlans.clinic.interval.${p.interval}`)}</td>
              <td className="px-2 py-1.5 font-mono" dir="ltr">{p.amount} {p.currency}</td><td className="px-2 py-1.5 text-xs" dir="ltr">{formatWhen(p.effectiveFrom, i18n.language)}</td>
              <td className="px-2 py-1.5 text-xs"><span dir="ltr">{p.proposedByEmail ?? p.proposedBy}</span>{p.decidedBy ? <span className="block text-muted-foreground" dir="ltr">{t("kiorlyPrices.proposals.decidedBy", { who: p.decidedBy })}</span> : null}{p.decisionNote ? <span className="block text-muted-foreground">{p.decisionNote}</span> : null}</td>
              <td className="px-2 py-1.5"><StatusChip tone={BADGE[p.status]} data-testid={`status-${p.id}`}>{t(`kiorlyPrices.proposals.status.${p.status}`)}</StatusChip>{p.status === "APPROVED" && p.publishedVersion ? <span className="block text-xs text-muted-foreground">{t("kiorlyPrices.proposals.version", { version: p.publishedVersion })}</span> : null}{p.lastError && p.status === "PENDING" ? <span className="block text-xs text-destructive">{t("kiorlyPrices.proposals.lastError", { code: p.lastError })}</span> : null}{p.warnings.length ? <span className="block text-xs text-warning" data-testid={`warn-${p.id}`}>{t("kiorlyPrices.proposals.warnings", { count: p.warnings.length })}</span> : null}</td>
              <td className="px-2 py-1.5"><div className="flex flex-wrap gap-1">
                {a.approve ? <Button size="sm" onClick={() => setDec({ p, action: "approve" })} data-testid={`approve-${p.id}`}>{t("kiorlyPrices.decide.approveButton")}</Button> : null}
                {a.reject ? <Button size="sm" variant="outline" onClick={() => setDec({ p, action: "reject" })} data-testid={`reject-${p.id}`}>{t("kiorlyPrices.decide.rejectButton")}</Button> : null}
                {a.withdraw ? <Button size="sm" variant="ghost" disabled={withdraw.isPending} onClick={() => { setErr(null); withdraw.mutate({ id: p.id, action: "withdraw" }, { onSuccess: () => setMsg(t("kiorlyPrices.proposals.withdrawn")), onError: (e) => setErr(errText(e)) }); }} data-testid={`withdraw-${p.id}`}>{t("kiorlyPrices.decide.withdrawButton")}</Button> : null}
                {a.ownPending ? <span className="text-xs text-muted-foreground" data-testid={`own-${p.id}`}>{t("kiorlyPrices.proposals.ownHint")}</span> : null}
              </div></td>
            </tr>); })}</tbody></table></div>
      )}
      {dec ? <DecideDialog p={dec.p} action={dec.action} onClose={() => setDec(null)} onDone={() => { setMsg(t(`kiorlyPrices.proposals.${dec.action === "approve" ? "approved" : "rejected"}`)); setDec(null); }} /> : null}
    </section>
  );
}
