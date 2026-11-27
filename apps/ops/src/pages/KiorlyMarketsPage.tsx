import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CardSkeleton, ErrorState } from "@/components/states";
import { PageHeader, StatusChip, type Tone } from "@/components/kit";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/auth/AuthProvider";
import {
  useCountryDefaults, useCreateMarket, useDecideRequest, useKiorlyMarkets, useMarketAudit, useMarketDetail, useMarketRequests, useSaveLegal, useSaveTaxPack, useSecondApprover, useTransition,
  type KiorlyMarket, type Verb,
} from "@/api/kiorlyMarkets";
import { actionsFor, applyCountry, changeBody, cellFor, emptyForm, errorCode, kiorexTone, toCreateBody, validateChange, validateForm, type FormState } from "@/lib/kiorlyMarketsLogic";

const REGIONS = ["eu-central-1", "eu-west-1", "me-central-1", "me-south-1", "af-south-1", "us-east-1", "us-west-2"];
const CURRENCIES = ["EGP", "AED", "SAR", "OMR", "QAR", "KWD", "BHD", "USD", "EUR", "GBP", "JOD"];
const SUB_PROCESSORS = ["aws-eu-central-1", "openai-eu", "whatsapp-bsp", "ses-eu", "paymob"];
const selectCls = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";
const TONE_OP: Record<string, Tone> = { active: "success", paused: "warning", disabled: "danger" };

/** Message for an error: the API code selects the translated text; an unreachable Clinic and a transport failure have their own. */
function useErrText() {
  const { t } = useTranslation();
  return (e: unknown): string => {
    const code = errorCode(e);
    if (code) { const k = `kiorlyMarkets.errors.${code}`; const s = t(k, { defaultValue: "" }); if (s) return s; }
    return t("kiorlyMarkets.errors.generic");
  };
}

function Prereq({ m }: { m: KiorlyMarket }) {
  const { t } = useTranslation(); const r = m.readiness;
  const line = (ok: boolean, yes: string, no: string) => <span className={ok ? "block text-success" : "block text-warning"}>{ok ? yes : no}</span>;
  return (
    <div className="text-xs" data-testid={`prereq-${m.code}`}>
      {line(r.taxPack.ok, t("kiorlyMarkets.prereq.taxOk"), t("kiorlyMarkets.prereq.taxMissing"))}
      {r.crossBorder.required ? line(r.crossBorder.approved, m.crossBorderApprovalRef ?? t("kiorlyMarkets.prereq.transferOk"), t("kiorlyMarkets.prereq.transferMissing")) : <span className="block text-muted-foreground">{t("kiorlyMarkets.prereq.transferNotRequired")}</span>}
      {!r.hostCellKnown ? <span className="block text-warning">{t("kiorlyMarkets.prereq.cellMissing")}</span> : null}
      {m.status === "DRAFT" ? <span className="mt-1 block font-semibold">{r.canLaunch ? t("kiorlyMarkets.prereq.ready") : t("kiorlyMarkets.prereq.notReady")}</span> : null}
    </div>
  );
}

function KiorexCell({ m }: { m: KiorlyMarket }) {
  const { t } = useTranslation(); const k = m.kiorex;
  const label = k.live ? t("kiorlyMarkets.kiorex.live") : k.known ? (k.state === "AWAITING_GATE" ? t("kiorlyMarkets.kiorex.waiting") : t("kiorlyMarkets.kiorex.off")) : t("kiorlyMarkets.kiorex.none");
  return <span data-testid={`kiorex-${m.code}`}><StatusChip tone={kiorexTone(k)}>{label}</StatusChip><span className="mt-1 block text-[11px] text-muted-foreground">{t("kiorlyMarkets.kiorex.readonly")}</span></span>;
}

function ActionDialog({ market, verb, onClose, onDone }: { market: KiorlyMarket; verb: Verb; onClose: () => void; onDone: (note?: string) => void }) {
  const { t } = useTranslation(); const errText = useErrText(); const mut = useTransition();
  const [i, setI] = useState({ reason: "", approvalRef: "", approvalLink: "", days: "7" }); const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    if (mut.isPending) return; // double click
    const bad = validateChange(verb, i);
    if (bad) return setErr(t(`kiorlyMarkets.errors.${bad}`));
    setErr(null);
    mut.mutate({ id: market.id, verb, body: changeBody(verb, i) }, { onSuccess: (r) => onDone(r?.pending ? t("kiorlyMarkets.action.pendingSent") : r?.unchanged ? t("kiorlyMarkets.action.unchanged") : t("kiorlyMarkets.action.done")), onError: (e) => setErr(errText(e)) });
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !mut.isPending) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid={`action-${verb}`}>
        <DialogHeader><DialogTitle>{t(`kiorlyMarkets.action.${verb}.title`)}: {market.code} {market.nameEn}</DialogTitle><DialogDescription>{t(`kiorlyMarkets.action.${verb}.intro`)}</DialogDescription></DialogHeader>
        {market.requireSecondApprover ? <p className="rounded-md bg-muted px-3 py-2 text-sm">{t("kiorlyMarkets.action.second")}</p> : null}
        <div className="grid gap-3">
          <div><Label htmlFor="km-reason">{t("kiorlyMarkets.action.reason")}</Label><Textarea id="km-reason" value={i.reason} maxLength={1000} onChange={(e) => setI({ ...i, reason: e.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="km-ref">{t("kiorlyMarkets.action.approvalRef")}</Label><Input id="km-ref" dir="ltr" value={i.approvalRef} maxLength={128} onChange={(e) => setI({ ...i, approvalRef: e.target.value })} /></div>
            <div><Label htmlFor="km-link">{t("kiorlyMarkets.action.approvalLink")}</Label><Input id="km-link" dir="ltr" placeholder="https://" value={i.approvalLink} maxLength={500} onChange={(e) => setI({ ...i, approvalLink: e.target.value })} /></div>
          </div>
          {verb === "pause" ? <div><Label htmlFor="km-days">{t("kiorlyMarkets.action.days")}</Label><Input id="km-days" dir="ltr" inputMode="numeric" className="max-w-32" value={i.days} onChange={(e) => setI({ ...i, days: e.target.value })} /></div> : null}
          {err ? <p role="alert" className="text-sm text-destructive" data-testid="action-error">{err}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>{t("kiorlyMarkets.action.cancel")}</Button>
            <Button onClick={submit} disabled={mut.isPending} data-testid="action-confirm">{mut.isPending ? t("kiorlyMarkets.action.working") : t(`kiorlyMarkets.action.${verb}.confirm`)}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(); const errText = useErrText(); const defaults = useCountryDefaults(true); const create = useCreateMarket();
  const [f, setF] = useState<FormState>(emptyForm()); const [reason, setReason] = useState(""); const [touched, setTouched] = useState(false); const [err, setErr] = useState<string | null>(null);
  const bad = validateForm(f);
  const fe = (k: keyof typeof bad) => (touched && bad[k] ? <p className="text-xs text-destructive" role="alert">{t(`kiorlyMarkets.errors.field.${k}`)}</p> : null);
  const submit = () => {
    if (create.isPending) return;
    setTouched(true);
    if (Object.keys(validateForm(f)).length) return;
    setErr(null);
    create.mutate(toCreateBody(f, reason), { onSuccess: onDone, onError: (e) => setErr(errText(e)) });
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !create.isPending) onClose(); }}>
      <DialogContent className="max-w-xl" data-testid="create-dialog">
        <DialogHeader><DialogTitle>{t("kiorlyMarkets.form.title")}</DialogTitle><DialogDescription>{t("kiorlyMarkets.form.note")}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div><Label htmlFor="mk-country">{t("kiorlyMarkets.form.country")}</Label>
            <select id="mk-country" className={selectCls} value={f.code} onChange={(e) => setF(applyCountry(f, e.target.value, defaults.data ?? []))}>
              <option value="">{t("kiorlyMarkets.form.pick")}</option>{(defaults.data ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} - {c.nameEn}</option>)}
            </select>{fe("code")}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="mk-en">{t("kiorlyMarkets.form.nameEn")}</Label><Input id="mk-en" value={f.nameEn} maxLength={200} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />{fe("nameEn")}</div>
            <div><Label htmlFor="mk-ar">{t("kiorlyMarkets.form.nameAr")}</Label><Input id="mk-ar" dir="rtl" value={f.nameAr} maxLength={200} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></div>
            <div><Label htmlFor="mk-region">{t("kiorlyMarkets.form.region")}</Label><select id="mk-region" className={selectCls} value={f.dataRegion} onChange={(e) => setF({ ...f, dataRegion: e.target.value, hostCell: cellFor(e.target.value) })}>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>{fe("region")}</div>
            <div><Label htmlFor="mk-cell">{t("kiorlyMarkets.form.cell")}</Label><Input id="mk-cell" dir="ltr" value={f.hostCell} onChange={(e) => setF({ ...f, hostCell: e.target.value })} />{fe("hostCell")}</div>
            <div><Label htmlFor="mk-cur">{t("kiorlyMarkets.form.currency")}</Label><select id="mk-cur" className={selectCls} value={f.defaultCurrency} onChange={(e) => setF({ ...f, defaultCurrency: e.target.value })}><option value="" />{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>{fe("currency")}</div>
            <div><Label htmlFor="mk-tz">{t("kiorlyMarkets.form.timezone")}</Label><Input id="mk-tz" dir="ltr" placeholder="Africa/Cairo" value={f.defaultTimezone} onChange={(e) => setF({ ...f, defaultTimezone: e.target.value })} />{fe("timezone")}</div>
            <div><Label htmlFor="mk-loc">{t("kiorlyMarkets.form.locale")}</Label><Input id="mk-loc" dir="ltr" placeholder="ar-EG" value={f.defaultLocale} onChange={(e) => setF({ ...f, defaultLocale: e.target.value })} />{fe("locale")}</div>
            <div><Label htmlFor="mk-ph">{t("kiorlyMarkets.form.phone")}</Label><Input id="mk-ph" dir="ltr" maxLength={2} placeholder="EG" value={f.defaultPhoneRegion} onChange={(e) => setF({ ...f, defaultPhoneRegion: e.target.value.toUpperCase() })} />{fe("phoneRegion")}</div>
          </div>
          <fieldset><legend className="text-sm font-medium">{t("kiorlyMarkets.form.weekend")}</legend>
            <div className="mt-1 flex flex-wrap gap-3">{[0, 1, 2, 3, 4, 5, 6].map((n) => <label key={n} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.weekendDays.includes(n)} onChange={(e) => setF({ ...f, weekendDays: e.target.checked ? [...f.weekendDays, n] : f.weekendDays.filter((x) => x !== n) })} />{t(`kiorlyMarkets.form.day.${n}`)}</label>)}</div>{fe("weekend")}</fieldset>
          <fieldset><legend className="text-sm font-medium">{t("kiorlyMarkets.form.languages")}</legend>
            <div className="mt-1 flex gap-3">{["ar", "en"].map((l) => <label key={l} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.enabledLanguages.includes(l)} onChange={(e) => setF({ ...f, enabledLanguages: e.target.checked ? [...f.enabledLanguages, l] : f.enabledLanguages.filter((x) => x !== l) })} />{l}</label>)}</div>{fe("languages")}</fieldset>
          <div><Label htmlFor="mk-why">{t("kiorlyMarkets.form.reason")}</Label><Input id="mk-why" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></div>
          {err ? <p role="alert" className="text-sm text-destructive" data-testid="create-error">{err}</p> : null}
          <Button onClick={submit} disabled={create.isPending} data-testid="create-save">{create.isPending ? t("kiorlyMarkets.form.saving") : t("kiorlyMarkets.form.save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailsDialog({ id, canChange, onClose }: { id: string; canChange: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation(); const errText = useErrText();
  const q = useMarketDetail(id); const reqs = useMarketRequests(id);
  const [before, setBefore] = useState<string | null>(null); const [rows, setRows] = useState<Array<{ id: string }>>([]);
  const audit = useMarketAudit(id, before);
  const tax = useSaveTaxPack(), legal = useSaveLegal(), second = useSecondApprover(), decide = useDecideRequest();
  const [reason, setReason] = useState(""); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const m = q.data?.market; const r = m?.readiness;
  const [vat, setVat] = useState<string | null>(null), [saas, setSaas] = useState<string | null>(null), [fee, setFee] = useState<string | null>(null), [trnReq, setTrnReq] = useState<boolean | null>(null), [trnFmt, setTrnFmt] = useState<string | null>(null);
  const cbt = (q.data?.legal.config.crossBorderTransfer ?? {}) as Record<string, unknown>;
  const [lg, setLg] = useState<Record<string, string | string[]>>({});
  const lv = (k: string, d = "") => (typeof lg[k] === "string" ? (lg[k] as string) : typeof cbt[k] === "string" ? (cbt[k] as string) : d);
  const subs = (Array.isArray(lg.subProcessors) ? lg.subProcessors : Array.isArray(cbt.subProcessors) ? (cbt.subProcessors as string[]) : []) as string[];
  const ok = (text: string) => setMsg({ ok: true, text }); const fail = (e: unknown) => setMsg({ ok: false, text: errText(e) });
  const reasonOk = reason.trim().length >= 3;
  const list = audit.data ? (before ? [...rows, ...audit.data.items.filter((x) => !rows.some((p) => p.id === x.id))] : audit.data.items) : rows;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="details-dialog">
        <DialogHeader><DialogTitle>{t("kiorlyMarkets.details.title")}: {m ? `${m.code} ${m.nameEn}` : ""}</DialogTitle><DialogDescription>{t("kiorlyMarkets.details.kiorexHint")}</DialogDescription></DialogHeader>
        {q.isLoading ? <CardSkeleton rows={1} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : m && r ? (
          <div className="grid gap-5">
            <section data-testid="details-kiorex"><h3 className="text-sm font-semibold">{t("kiorlyMarkets.details.kiorexTitle")}</h3><KiorexCell m={m} /></section>
            <section><h3 className="text-sm font-semibold">{t("kiorlyMarkets.details.blockers")}</h3>
              {r.blockers.length ? <ul className="ms-5 list-disc text-sm">{r.blockers.map((b) => <li key={b.code}>{t(`kiorlyMarkets.errors.${b.code}`, { defaultValue: b.message })}</li>)}</ul> : <p className="text-sm text-muted-foreground">{t("kiorlyMarkets.details.none")}</p>}
              <p className="mt-2 text-sm">{t("kiorlyMarkets.details.commercial")}: <StatusChip tone={r.commercialConfigured ? "success" : "neutral"}>{r.commercialConfigured ? t("kiorlyMarkets.details.commercialSet") : t("kiorlyMarkets.details.commercialUnset")}</StatusChip></p></section>
            {canChange ? (
              <>
                <div><Label htmlFor="km-dreason">{t("kiorlyMarkets.details.reason")}</Label><Input id="km-dreason" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} /></div>
                <section className="grid gap-3"><h3 className="text-sm font-semibold">{t("kiorlyMarkets.details.tax")}</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><Label htmlFor="km-vat">{t("kiorlyMarkets.details.invoiceVat")}</Label><Input id="km-vat" dir="ltr" inputMode="decimal" value={vat ?? String(r.taxPack.invoiceVatPercent ?? "")} onChange={(e) => setVat(e.target.value)} /></div>
                    <div><Label htmlFor="km-saas">{t("kiorlyMarkets.details.saasVat")}</Label><Input id="km-saas" dir="ltr" inputMode="decimal" value={saas ?? String(r.taxPack.saasVatPercent ?? "")} onChange={(e) => setSaas(e.target.value)} /></div>
                    <div><Label htmlFor="km-fee">{t("kiorlyMarkets.details.visitFee")}</Label><Input id="km-fee" dir="ltr" inputMode="decimal" value={fee ?? String(r.taxPack.defaultVisitFee ?? "")} onChange={(e) => setFee(e.target.value)} /></div>
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={trnReq ?? Boolean(r.taxPack.trnRequired)} onChange={(e) => setTrnReq(e.target.checked)} />{t("kiorlyMarkets.details.trnRequired")}</label>
                  <div><Label htmlFor="km-trn">{t("kiorlyMarkets.details.trnFormat")}</Label><Input id="km-trn" dir="ltr" value={trnFmt ?? r.taxPack.trnFormat ?? ""} onChange={(e) => setTrnFmt(e.target.value)} /></div>
                  <Button className="w-fit" disabled={!reasonOk || tax.isPending} data-testid="save-tax" onClick={() => { setMsg(null); const v = vat ?? String(r.taxPack.invoiceVatPercent ?? ""), s = saas ?? String(r.taxPack.saasVatPercent ?? ""), f = fee ?? String(r.taxPack.defaultVisitFee ?? ""); tax.mutate({ id, body: { invoiceVatPercent: v.trim() === "" ? NaN : Number(v), saasVatPercent: s.trim() === "" ? NaN : Number(s), defaultVisitFee: f.trim() === "" ? NaN : Number(f), trnRequired: trnReq ?? Boolean(r.taxPack.trnRequired), trnFormat: (trnFmt ?? r.taxPack.trnFormat ?? "") || null, reason: reason.trim() } }, { onSuccess: () => ok(t("kiorlyMarkets.details.saved")), onError: fail }); }}>{t("kiorlyMarkets.details.saveTax")}</Button></section>
                <section className="grid gap-3"><h3 className="text-sm font-semibold">{t("kiorlyMarkets.details.legal")}{q.data?.legal.crossBorderRequired ? "" : ` (${t("kiorlyMarkets.prereq.transferNotRequired")})`}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><Label htmlFor="km-lref">{t("kiorlyMarkets.details.legalRef")}</Label><Input id="km-lref" dir="ltr" value={lv("approvalRef")} onChange={(e) => setLg({ ...lg, approvalRef: e.target.value })} /></div>
                    <div><Label htmlFor="km-ldest">{t("kiorlyMarkets.details.destination")}</Label><Input id="km-ldest" dir="ltr" value={lv("destination")} onChange={(e) => setLg({ ...lg, destination: e.target.value })} /></div>
                    <div><Label htmlFor="km-liss">{t("kiorlyMarkets.details.issuedAt")}</Label><Input id="km-liss" dir="ltr" value={lv("issuedAt")} onChange={(e) => setLg({ ...lg, issuedAt: e.target.value })} /></div>
                    <div><Label htmlFor="km-lexp">{t("kiorlyMarkets.details.expiresAt")}</Label><Input id="km-lexp" dir="ltr" value={lv("expiresAt")} onChange={(e) => setLg({ ...lg, expiresAt: e.target.value })} /></div>
                  </div>
                  <fieldset><legend className="text-sm font-medium">{t("kiorlyMarkets.details.subProcessors")}</legend><div className="mt-1 flex flex-wrap gap-3">{SUB_PROCESSORS.map((s) => <label key={s} className="flex items-center gap-1 text-sm" dir="ltr"><input type="checkbox" checked={subs.includes(s)} onChange={(e) => setLg({ ...lg, subProcessors: e.target.checked ? [...subs, s] : subs.filter((x) => x !== s) })} />{s}</label>)}</div></fieldset>
                  <Button className="w-fit" disabled={!reasonOk || legal.isPending} data-testid="save-legal" onClick={() => { setMsg(null); legal.mutate({ id, body: { crossBorderTransfer: { approvalRef: lv("approvalRef"), issuedAt: lv("issuedAt"), expiresAt: lv("expiresAt"), destination: lv("destination"), subProcessors: subs }, reason: reason.trim() } }, { onSuccess: () => ok(t("kiorlyMarkets.details.saved")), onError: fail }); }}>{t("kiorlyMarkets.details.saveLegal")}</Button></section>
                <section className="grid gap-2"><h3 className="text-sm font-semibold">{t("kiorlyMarkets.details.second")}</h3><p className="text-sm text-muted-foreground">{m.requireSecondApprover ? t("kiorlyMarkets.details.secondOn") : t("kiorlyMarkets.details.secondOff")}</p>
                  <Button variant="outline" className="w-fit" disabled={!reasonOk || second.isPending} data-testid="toggle-second" onClick={() => { setMsg(null); second.mutate({ id, body: { requireSecondApprover: !m.requireSecondApprover, reason: reason.trim() } }, { onSuccess: () => ok(t("kiorlyMarkets.details.saved")), onError: fail }); }}>{m.requireSecondApprover ? t("kiorlyMarkets.details.turnOff") : t("kiorlyMarkets.details.turnOn")}</Button></section>
              </>
            ) : null}
            <section className="grid gap-2"><h3 className="text-sm font-semibold">{t("kiorlyMarkets.details.pending")}</h3>
              {(reqs.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">{t("kiorlyMarkets.details.noPending")}</p> : null}
              {(reqs.data ?? []).map((x) => <div key={x.id} className="rounded-md border p-2 text-sm" data-testid="pending-request"><div className="font-medium">{x.action}</div><p className="text-muted-foreground" dir="auto">{x.reason}</p><p className="text-xs text-muted-foreground" dir="ltr">{x.requestedEmail ?? x.requestedBy}</p>
                {canChange ? <div className="mt-2 flex gap-2"><Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id, rid: x.id, verb: "approve" }, { onError: fail })}>{t("kiorlyMarkets.details.approve")}</Button><Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id, rid: x.id, verb: "reject" }, { onError: fail })}>{t("kiorlyMarkets.details.reject")}</Button></div> : null}</div>)}</section>
            {msg ? <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-destructive"} data-testid="details-msg">{msg.text}</p> : null}
            <section data-testid="history"><h3 className="text-sm font-semibold">{t("kiorlyMarkets.history.title")}</h3>
              {audit.isLoading ? <CardSkeleton rows={1} /> : null}
              {!audit.isLoading && list.length === 0 ? <p className="text-sm text-muted-foreground">{t("kiorlyMarkets.history.empty")}</p> : null}
              <ul className="mt-2 grid gap-2">{(list as import("@/api/kiorlyMarkets").AuditEvent[]).map((e) => <li key={e.id} className="rounded-md border p-3 text-sm" data-testid="history-row">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{e.action}{e.toStatus && e.fromStatus !== e.toStatus ? ` (${e.fromStatus ?? ""} ${t("kiorlyMarkets.history.to")} ${e.toStatus})` : ""}{e.toOperational && e.fromOperational !== e.toOperational ? ` (${e.fromOperational ?? ""} ${t("kiorlyMarkets.history.to")} ${e.toOperational})` : ""}</span><time className="text-xs text-muted-foreground" dir="ltr">{formatDateTime(e.createdAt, i18n.language)}</time></div>
                <p className="mt-1 text-muted-foreground" dir="auto">{e.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground" dir="ltr">{e.actorEmail ?? e.actorId} · {e.actorSource}{e.approvalRef ? ` · ${t("kiorlyMarkets.history.approval")}: ${e.approvalRef}` : ""}{e.secondApproverId ? ` · ${t("kiorlyMarkets.history.secondApprover")}: ${e.secondApproverId}` : ""}</p>
                {e.approvalLink ? <a className="text-xs underline" href={e.approvalLink} target="_blank" rel="noopener noreferrer" dir="ltr">{e.approvalLink}</a> : null}</li>)}</ul>
              {audit.data?.nextBefore ? <Button className="mt-2" variant="outline" onClick={() => { setRows(list as Array<{ id: string }>); setBefore(audit.data!.nextBefore); }}>{t("kiorlyMarkets.history.more")}</Button> : null}</section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function KiorlyMarketsPage() {
  const { t } = useTranslation(); const { user } = useAuth();
  const q = useKiorlyMarkets();
  const [create, setCreate] = useState(false); const [act, setAct] = useState<{ m: KiorlyMarket; verb: Verb } | null>(null); const [details, setDetails] = useState<string | null>(null); const [note, setNote] = useState<string | null>(null);
  const canChange = q.data?.canChange ?? !!user?.roles.includes("super_admin");
  const items = q.data?.items ?? [];
  return (
    <div>
      <PageHeader title={t("kiorlyMarkets.title")} hint={t("kiorlyMarkets.hint")} icon={<Globe2 />} actions={canChange ? <Button onClick={() => setCreate(true)} data-testid="new-market">{t("kiorlyMarkets.new")}</Button> : null} />
      {!canChange && q.data ? <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm" data-testid="read-only-note">{t("kiorlyMarkets.readOnly")}</p> : null}
      {note ? <p role="status" className="mb-4 text-sm text-success" data-testid="page-note">{note}</p> : null}
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">{t("kiorlyMarkets.liveCount", { count: items.filter((m) => m.status === "LIVE").length })}</p>
          {items.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="markets-empty">{t("kiorlyMarkets.empty")}</p> : (
            <div className="overflow-x-auto rounded-xl border bg-card shadow-card">
              <table className="w-full min-w-[900px] text-sm" data-testid="markets-table">
                <thead className="bg-muted/60"><tr>{["code", "market", "region", "status", "prereq", "kiorex", "actions"].map((c) => <th key={c} className={`px-3 py-2 ${c === "actions" ? "text-end" : "text-start"}`}>{t(`kiorlyMarkets.col.${c}`)}</th>)}</tr></thead>
                <tbody>
                  {items.map((m) => (
                    <tr key={m.id} className="border-t" data-testid={`market-${m.code}`}>
                      <td className="px-3 py-2 font-mono" dir="ltr">{m.code}</td>
                      <td className="px-3 py-2">{m.nameEn}{m.nameAr ? <span className="text-muted-foreground"> · {m.nameAr}</span> : null}{typeof m.organizationCount === "number" ? <span className="block text-xs text-muted-foreground">{t("kiorlyMarkets.col.orgs")}: {m.organizationCount}</span> : null}</td>
                      <td className="px-3 py-2 font-mono text-xs" dir="ltr">{m.dataRegion}<span className="block text-muted-foreground">{m.hostCell}</span></td>
                      <td className="px-3 py-2"><div className="flex flex-col items-start gap-1"><StatusChip tone={m.status === "LIVE" ? "success" : "neutral"} data-testid={`state-${m.code}`}>{t(`kiorlyMarkets.status.${m.status}`)}</StatusChip>{m.status === "LIVE" ? <StatusChip tone={TONE_OP[m.operability] ?? "neutral"} data-testid={`op-${m.code}`}>{t(`kiorlyMarkets.status.${m.operability}`, { defaultValue: m.operability })}{m.pausedUntil ? ` → ${formatDateTime(m.pausedUntil, "en").split(" · ")[0]}` : ""}</StatusChip> : null}</div></td>
                      <td className="px-3 py-2"><Prereq m={m} /></td>
                      <td className="px-3 py-2"><KiorexCell m={m} /></td>
                      <td className="px-3 py-2 text-end"><div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setDetails(m.id)} data-testid={`details-${m.code}`}>{t("kiorlyMarkets.act.details")}</Button>
                        {actionsFor(m, canChange).map((verb) => <Button key={verb} size="sm" variant={verb === "disable" ? "ghost" : "outline"} onClick={() => setAct({ m, verb })} data-testid={`${verb}-${m.code}`}>{t(`kiorlyMarkets.act.${verb}`)}</Button>)}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {create ? <CreateDialog onClose={() => setCreate(false)} onDone={() => { setCreate(false); setNote(t("kiorlyMarkets.action.done")); }} /> : null}
      {act ? <ActionDialog market={act.m} verb={act.verb} onClose={() => setAct(null)} onDone={(n) => { setAct(null); setNote(n ?? null); }} /> : null}
      {details ? <DetailsDialog id={details} canChange={canChange} onClose={() => setDetails(null)} /> : null}
    </div>
  );
}
