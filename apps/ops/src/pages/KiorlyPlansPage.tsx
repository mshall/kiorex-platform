import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CardSkeleton, ErrorState } from "@/components/states";
import { PageHeader, StatusChip } from "@/components/kit";
import { useAuth } from "@/auth/AuthProvider";
import { usePatchPlan, usePlansOverview, useSaveContent, type ClinicPlan, type ContentConfig, type ContentPlan } from "@/api/kiorlyPlans";
import { cleanContent, contentChanged, contentIssues, contentValid, formatWhen, linesToList, listToLines, priceState, sortPrices } from "@/lib/kiorlyPlansLogic";
import { ProductPricesSection, ProposalsSection, ProposeDialog } from "@/pages/KiorlyPrices";
import { errorCode } from "@/lib/kiorlyMarketsLogic";

function useErrText() {
  const { t } = useTranslation();
  return (e: unknown): string => {
    const code = errorCode(e);
    if (code) { const s = t(`kiorlyPlans.errors.${code}`, { defaultValue: "" }); if (s) return s; }
    return t("kiorlyPlans.errors.generic");
  };
}

function PlanDialog({ plan, onClose, onDone }: { plan: ClinicPlan; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(); const errText = useErrText(); const mut = usePatchPlan();
  const [f, setF] = useState({ nameEn: plan.nameEn, nameAr: plan.nameAr, isPublic: plan.isPublic, sortOrder: String(plan.sortOrder) });
  const [err, setErr] = useState<string | null>(null);
  const bad = !f.nameEn.trim() || !/^-?\d{1,4}$/.test(f.sortOrder.trim());
  const submit = () => {
    if (mut.isPending || bad) return;
    setErr(null);
    mut.mutate({ id: plan.id, body: { nameEn: f.nameEn.trim(), nameAr: f.nameAr.trim(), isPublic: f.isPublic, sortOrder: Number(f.sortOrder) } }, { onSuccess: onDone, onError: (e) => setErr(errText(e)) });
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !mut.isPending) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="plan-dialog">
        <DialogHeader><DialogTitle>{t("kiorlyPlans.plan.title")}: {plan.key}</DialogTitle><DialogDescription>{t("kiorlyPlans.clinic.intro")}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div><Label htmlFor="kp-en">{t("kiorlyPlans.plan.nameEn")}</Label><Input id="kp-en" value={f.nameEn} maxLength={80} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></div>
          <div><Label htmlFor="kp-ar">{t("kiorlyPlans.plan.nameAr")}</Label><Input id="kp-ar" dir="rtl" value={f.nameAr} maxLength={80} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></div>
          <div><Label htmlFor="kp-order">{t("kiorlyPlans.plan.order")}</Label><Input id="kp-order" dir="ltr" inputMode="numeric" className="max-w-32" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} />{t("kiorlyPlans.plan.public")}</label>
          {err ? <p role="alert" className="text-sm text-destructive" data-testid="plan-error">{err}</p> : null}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose} disabled={mut.isPending}>{t("kiorlyPlans.price.cancel")}</Button><Button onClick={submit} disabled={mut.isPending || bad} data-testid="plan-save">{mut.isPending ? t("kiorlyPlans.price.working") : t("kiorlyPlans.plan.save")}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ClinicSection({ canChange }: { canChange: boolean }) {
  const { t, i18n } = useTranslation(); const q = usePlansOverview();
  const [edit, setEdit] = useState<ClinicPlan | null>(null); const [price, setPrice] = useState<ClinicPlan | null>(null); const [note, setNote] = useState<string | null>(null);
  const c = q.data?.clinic; const markets = c?.markets ?? []; const caps = q.data?.capabilities;
  const mcode = (id: string) => markets.find((m) => m.id === id)?.code ?? id;
  const money = (p: { amount: string; currency: string }) => `${p.amount} ${p.currency}`;
  return (
    <section className="mb-10" aria-labelledby="kp-clinic" data-testid="clinic-section">
      <h2 id="kp-clinic" className="text-lg font-semibold">{t("kiorlyPlans.clinic.title")}</h2>
      <p className="mb-3 text-sm text-muted-foreground">{t("kiorlyPlans.clinic.intro")}</p>
      {note ? <p role="status" className="mb-3 text-sm text-success" data-testid="page-note">{note}</p> : null}
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !c?.available ? <p className="rounded-md bg-muted px-3 py-2 text-sm" role="alert" data-testid="clinic-unavailable">{t("kiorlyPlans.clinic.unavailable")}</p> : c.plans.length === 0 ? <p className="text-sm text-muted-foreground">{t("kiorlyPlans.clinic.empty")}</p> : (
        <div className="grid gap-4">
          {[...c.plans].sort((a, b) => a.sortOrder - b.sortOrder).map((p) => {
            const rows = sortPrices(p.prices);
            return (
              <article key={p.id} className="rounded-xl border bg-card p-4 shadow-card" data-testid={`clinic-plan-${p.key}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><h3 className="font-semibold">{p.nameEn} <span className="text-muted-foreground">· {p.nameAr}</span> <span className="font-mono text-xs text-muted-foreground" dir="ltr">{p.key}</span></h3>
                    <StatusChip tone={p.isPublic ? "success" : "neutral"} data-testid={`public-${p.key}`}>{p.isPublic ? t("kiorlyPlans.clinic.public") : t("kiorlyPlans.clinic.hidden")}</StatusChip>
                    <span className="ms-2 text-xs text-muted-foreground">{t("kiorlyPlans.clinic.order")}: {p.sortOrder}</span></div>
                  <div className="flex gap-2">{canChange ? <Button size="sm" variant="outline" onClick={() => setEdit(p)} data-testid={`edit-${p.key}`}>{t("kiorlyPlans.clinic.edit")}</Button> : null}{caps?.canPropose ? <Button size="sm" onClick={() => setPrice(p)} data-testid={`new-price-${p.key}`}>{t("kiorlyPrices.propose.button")}</Button> : null}</div>
                </div>
                {rows.length === 0 ? <p className="mt-3 text-sm text-muted-foreground" data-testid={`no-price-${p.key}`}>{t("kiorlyPlans.clinic.noPrices")}</p> : (
                  <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-muted/60"><tr>{["market", "interval", "unit", "amount", "included", "version", "from", "to", "state"].map((k) => <th key={k} className="px-2 py-1.5 text-start">{t(`kiorlyPlans.clinic.col.${k}`)}</th>)}</tr></thead>
                    <tbody>{rows.map((r) => { const st = priceState(r); return (
                      <tr key={r.id} className="border-t" data-testid={`price-${p.key}-${r.priceVersion}-${r.interval}`}>
                        <td className="px-2 py-1.5 font-mono" dir="ltr">{mcode(r.marketId)}</td><td className="px-2 py-1.5">{t(`kiorlyPlans.clinic.interval.${r.interval}`)}</td><td className="px-2 py-1.5">{t(`kiorlyPlans.clinic.unit.${r.unit}`)}</td>
                        <td className="px-2 py-1.5 font-mono" dir="ltr">{money(r)}{r.extraClinicianAmount ? ` (+${r.extraClinicianAmount})` : ""}</td><td className="px-2 py-1.5">{r.includedClinicians}</td><td className="px-2 py-1.5">{r.priceVersion}</td>
                        <td className="px-2 py-1.5 text-xs" dir="ltr">{formatWhen(r.validFrom, i18n.language)}</td><td className="px-2 py-1.5 text-xs" dir="ltr">{r.validTo ? formatWhen(r.validTo, i18n.language) : "-"}</td>
                        <td className="px-2 py-1.5"><StatusChip tone={st === "active" ? "success" : st === "scheduled" ? "info" : "neutral"}>{t(`kiorlyPlans.clinic.state.${st}`)}</StatusChip>{r.cohortKey ? <span className="block text-[11px] text-muted-foreground">{t("kiorlyPlans.clinic.cohort")}</span> : null}</td>
                      </tr>); })}</tbody></table></div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {edit ? <PlanDialog plan={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); setNote(t("kiorlyPlans.saved")); }} /> : null}
      {price ? <ProposeDialog product="CLINIC" planRef={price.id} planLabel={price.nameEn} markets={markets} onClose={() => setPrice(null)} onDone={() => { setPrice(null); setNote(t("kiorlyPrices.proposed")); }} /> : null}
    </section>
  );
}

function ContentEditor({ canChange }: { canChange: boolean }) {
  const { t } = useTranslation(); const errText = useErrText(); const q = usePlansOverview(); const save = useSaveContent();
  const saved = q.data?.content; const [edits, setDraft] = useState<ContentConfig | null>(null); const draft = edits ?? saved?.config ?? null; const [mod, setMod] = useState<"pharmacy" | "lab">("pharmacy");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [nonce, setNonce] = useState(0);
  const dirty = useMemo(() => !!(saved && draft && contentChanged(cleanContent(draft), saved.config)), [saved, draft]);
  if (q.isLoading || !saved || !draft) return <section className="mb-10"><h2 className="text-lg font-semibold">{t("kiorlyPlans.content.title")}</h2><CardSkeleton rows={1} /></section>;
  const patch = (i: number, fn: (p: ContentPlan) => ContentPlan) => setDraft({ ...draft, [mod]: { plans: draft[mod].plans.map((p, k) => (k === i ? fn(p) : p)) } });
  const valid = contentValid(draft);
  const submit = () => {
    if (save.isPending || !valid || !dirty) return;
    setMsg(null);
    save.mutate({ version: saved.version, config: cleanContent(draft) }, { onSuccess: () => { setDraft(null); setMsg({ ok: true, text: t("kiorlyPlans.saved") }); }, onError: (e) => setMsg({ ok: false, text: errText(e) }) });
  };
  return (
    <section className="mb-10" aria-labelledby="kp-content" data-testid="content-section">
      <h2 id="kp-content" className="text-lg font-semibold">{t("kiorlyPlans.content.title")}</h2>
      <p className="mb-2 text-sm text-muted-foreground">{t("kiorlyPlans.content.intro")}</p>
      <p className="mb-3 text-xs text-muted-foreground" data-testid="content-version">{saved.version === 0 ? t("kiorlyPlans.content.isDefault") : t("kiorlyPlans.content.version", { version: saved.version, by: saved.updatedBy ?? "-" })}</p>
      <div role="tablist" className="mb-3 flex gap-2">{(["pharmacy", "lab"] as const).map((m) => <button key={m} role="tab" aria-selected={mod === m} onClick={() => setMod(m)} data-testid={`tab-${m}`} className={`rounded-lg border px-3 py-1.5 text-sm ${mod === m ? "bg-accent font-semibold" : ""}`}>{t(`kiorlyPlans.content.${m}`)}</button>)}</div>
      <div className="grid gap-4">
        {draft[mod].plans.map((p, i) => { const issues = contentIssues(p); const dis = !canChange; const id = `${mod}-${p.id}`; return (
          <article key={p.id} className="rounded-xl border bg-card p-4 shadow-card" data-testid={`content-plan-${mod}-${p.id}`}>
            <label className="mb-3 flex items-center gap-2 text-sm font-medium"><input type="checkbox" disabled={dis} checked={p.visible} data-testid={`visible-${id}`} onChange={(e) => patch(i, (x) => ({ ...x, visible: e.target.checked }))} />{t("kiorlyPlans.content.visible")} <span className="font-mono text-xs text-muted-foreground" dir="ltr">{p.id}</span></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor={`${id}-ne`}>{t("kiorlyPlans.content.nameEn")}</Label><Input id={`${id}-ne`} disabled={dis} value={p.name.en} maxLength={200} onChange={(e) => patch(i, (x) => ({ ...x, name: { ...x.name, en: e.target.value } }))} /></div>
              <div><Label htmlFor={`${id}-na`}>{t("kiorlyPlans.content.nameAr")}</Label><Input id={`${id}-na`} dir="rtl" disabled={dis} value={p.name.ar} maxLength={200} onChange={(e) => patch(i, (x) => ({ ...x, name: { ...x.name, ar: e.target.value } }))} /></div>
              <div><Label htmlFor={`${id}-se`}>{t("kiorlyPlans.content.summaryEn")}</Label><Input id={`${id}-se`} disabled={dis} value={p.summary.en} maxLength={200} onChange={(e) => patch(i, (x) => ({ ...x, summary: { ...x.summary, en: e.target.value } }))} /></div>
              <div><Label htmlFor={`${id}-sa`}>{t("kiorlyPlans.content.summaryAr")}</Label><Input id={`${id}-sa`} dir="rtl" disabled={dis} value={p.summary.ar} maxLength={200} onChange={(e) => patch(i, (x) => ({ ...x, summary: { ...x.summary, ar: e.target.value } }))} /></div>
              <div><Label htmlFor={`${id}-le`}>{t("kiorlyPlans.content.limitsEn")}</Label><Textarea id={`${id}-le`} rows={3} disabled={dis} defaultValue={listToLines(p.limits.en)} key={`${id}-le-${saved.version}-${nonce}`} onChange={(e) => patch(i, (x) => ({ ...x, limits: { ...x.limits, en: linesToList(e.target.value) } }))} /></div>
              <div><Label htmlFor={`${id}-la`}>{t("kiorlyPlans.content.limitsAr")}</Label><Textarea id={`${id}-la`} dir="rtl" rows={3} disabled={dis} defaultValue={listToLines(p.limits.ar)} key={`${id}-la-${saved.version}-${nonce}`} onChange={(e) => patch(i, (x) => ({ ...x, limits: { ...x.limits, ar: linesToList(e.target.value) } }))} /></div>
              <div><Label htmlFor={`${id}-fe`}>{t("kiorlyPlans.content.featuresEn")}</Label><Textarea id={`${id}-fe`} rows={5} disabled={dis} defaultValue={listToLines(p.features.en)} key={`${id}-fe-${saved.version}-${nonce}`} onChange={(e) => patch(i, (x) => ({ ...x, features: { ...x.features, en: linesToList(e.target.value) } }))} /></div>
              <div><Label htmlFor={`${id}-fa`}>{t("kiorlyPlans.content.featuresAr")}</Label><Textarea id={`${id}-fa`} dir="rtl" rows={5} disabled={dis} defaultValue={listToLines(p.features.ar)} key={`${id}-fa-${saved.version}-${nonce}`} onChange={(e) => patch(i, (x) => ({ ...x, features: { ...x.features, ar: linesToList(e.target.value) } }))} /></div>
            </div>
            {issues.length ? <ul className="mt-2 text-xs text-destructive" role="alert" data-testid={`issues-${id}`}>{issues.map((k) => <li key={k}>{t(`kiorlyPlans.content.issue.${k}`)}</li>)}</ul> : null}
          </article>); })}
      </div>
      {canChange ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={!dirty || !valid || save.isPending} data-testid="content-save">{save.isPending ? t("kiorlyPlans.content.working") : t("kiorlyPlans.content.save")}</Button>
          {dirty ? <Button variant="ghost" onClick={() => { setDraft(null); setNonce(nonce + 1); }} data-testid="content-reset">{t("kiorlyPlans.content.reset")}</Button> : null}
          {saved.version > 0 ? <Button variant="ghost" onClick={() => { setDraft(JSON.parse(JSON.stringify(saved.defaults))); setNonce(nonce + 1); }} data-testid="content-restore">{t("kiorlyPlans.content.restore")}</Button> : null}
          {dirty ? <span className="text-xs text-muted-foreground">{t("kiorlyPlans.content.unsaved")}</span> : null}
        </div>
      ) : null}
      {msg ? <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-success" : "text-destructive"}`} data-testid="content-msg">{msg.text}</p> : null}
    </section>
  );
}

export default function KiorlyPlansPage() {
  const { t } = useTranslation(); const { user } = useAuth(); const q = usePlansOverview();
  const canChange = q.data?.canChange ?? !!user?.roles.includes("super_admin");
  return (
    <div>
      <PageHeader title={t("kiorlyPlans.title")} hint={t("kiorlyPlans.hint")} icon={<Tags />} />
      {!canChange && q.data ? <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm" data-testid="read-only-note">{t("kiorlyPlans.readOnly")}</p> : null}
      {q.data?.capabilities?.canApprove ? <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm" data-testid="price-rule-note">{t("kiorlyPrices.rule.superAdmin")}</p> : null}
      <ClinicSection canChange={canChange} />
      <ProductPricesSection product="PHARMACY" markets={q.data?.clinic.markets ?? []} />
      <ProductPricesSection product="LAB" markets={q.data?.clinic.markets ?? []} />
      <ProposalsSection />
      <ContentEditor canChange={canChange} />
    </div>
  );
}
