import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAutomationCatalog, useAutomationStatus, useJourney, useJourneyActions, type Validation } from "@/api/automation";
import { useGrowthAccess } from "@/api/growth";
import { GrowthPage, Section, selectCls } from "@/components/growth/GrowthPage";
import { FlowView, StatusBanner, StatusLabel, btnCls, errText, inputCls, primaryBtnCls } from "./shared";
import { emptyModel, fromGraph, newStep, toGraph, type Model, type Step } from "./model";

const STAGES = ["REGISTERED", "ACTIVATED", "BOOKED", "ATTENDED", "RETAINED", "DORMANT", "CHURNED"];
const toggle = (xs: string[], v: string) => (xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]);

/**
 * The journey builder (GRW-P3-E): a constrained form, not a canvas and not a script. Closed vocabulary from the catalogue endpoint; every change is validated by the SERVER (the same validator that
 * guards publishing) and shown with a code and a path in words; the consent and gate marker is drawn in front of each marketing message and cannot be removed. Editing needs a wide screen
 * (below 768 px the page is read-only: the flow and its checks). A journey that left DRAFT is read-only and offers the maker-checker and stop actions.
 */
export default function JourneyBuilderPage({ id }: { id: string | null }) {
  const { t } = useTranslation(); const nav = useNavigate();
  const q = useJourney(id); const cat = useAutomationCatalog(); const st = useAutomationStatus(); const acts = useJourneyActions();
  const access = useGrowthAccess(); const can = !!(access.data?.capabilities as Record<string, boolean> | undefined)?.manageCampaigns;
  const j = q.data;
  const [key, setKey] = useState(""); const [name, setName] = useState(""); const [model, setModel] = useState<Model | null>(emptyModel());
  const [loaded, setLoaded] = useState<string | null>(null); const [check, setCheck] = useState<Validation | null>(null); const [msg, setMsg] = useState(""); const [note, setNote] = useState("");
  useEffect(() => { if (j && loaded !== j.id) { setLoaded(j.id); setKey(j.key); setName(j.name); setModel(fromGraph(j.graph)); } }, [j, loaded]);
  const editable = can && (!id || j?.status === "DRAFT") && !!model;
  const graph = useMemo(() => (model ? toGraph(model) : j?.graph ?? null), [model, j]);
  // validate on every change, 400 ms after the last one
  const validate = acts.validate.mutate;
  useEffect(() => { if (!graph || !editable) return; const h = setTimeout(() => validate(graph, { onSuccess: setCheck, onError: () => setCheck(null) }), 400); return () => clearTimeout(h); }, [graph, editable, validate]);
  const set = (i: number, s: Step) => setModel((m) => (m ? { ...m, steps: m.steps.map((x, k) => (k === i ? s : x)) } : m));
  const move = (i: number, d: -1 | 1) => setModel((m) => { if (!m) return m; const a = [...m.steps]; const k = i + d; if (k < 0 || k >= a.length) return m; [a[i], a[k]] = [a[k]!, a[i]!]; return { ...m, steps: a }; });
  const cls = (tpl: string) => cat.data?.templates.find((x) => x.key === tpl)?.messageClass ?? "TRANSACTIONAL";
  const chans = (tpl: string) => cat.data?.templates.find((x) => x.key === tpl)?.channels ?? [];
  const run = <T,>(m: { mutate: (v: T, o: { onSuccess: (r: unknown) => void; onError: (x: unknown) => void }) => void }, v: T, ok?: string) => { setMsg(""); m.mutate(v, { onSuccess: (r) => { const w = (r as { warnings?: string[] } | undefined)?.warnings; toast.success(w?.includes("MARKETING_FLAG_OFF") ? t("growth.automation.detail.warnMarketing") : ok ?? t("growth.automation.detail.done")); }, onError: (x) => setMsg(errText(t, x)) }); };
  const save = () => {
    if (!graph) return; setMsg("");
    if (id) acts.update.mutate({ id, name, graph }, { onSuccess: () => toast.success(t("growth.automation.builder.saved")), onError: (x) => setMsg(errText(t, x)) });
    else acts.create.mutate({ key, name, graph }, { onSuccess: (r) => { toast.success(t("growth.automation.builder.saved")); nav(`/growth/automation?id=${r.id}`); }, onError: (x) => setMsg(errText(t, x)) });
  };
  const errors = check && !check.valid ? check.errors : [];
  const field = "block text-sm";
  return (
    <GrowthPage section="automation" actions={<><Link to="/growth/automation" className={btnCls} data-testid="auto-back">{t("growth.automation.back")}</Link>{id && <Link to={`/growth/automation?id=${id}&view=dryrun`} className={btnCls} data-testid="auto-dry">{t("growth.automation.builder.dryRun")}</Link>}</>}>
      <StatusBanner status={st.data} />
      {!can && <p className="text-sm text-muted-foreground" data-testid="auto-needs-role">{t("growth.automation.builder.needsRole")}</p>}
      {j && <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl">{j.name || j.key}</h2><StatusLabel status={j.status} killed={!!j.killedAt} /><span className="text-sm text-muted-foreground" dir="ltr">v{j.version}</span></div>}
      {model === null && j && <p role="status" className="rounded-xl border p-3 text-sm" data-testid="auto-readonly-graph">{t("growth.automation.builder.readOnlyGraph")}</p>}
      {editable && <p role="status" className="rounded-xl border p-3 text-sm md:hidden" data-testid="auto-narrow">{t("growth.automation.builder.readOnlyNarrow")}</p>}

      {editable && model && (
        <div className="hidden space-y-5 md:block" data-testid="auto-form">
          <Section title={t("growth.automation.builder.title")} id="auto-form-title">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={field}><span className="font-medium">{t("growth.automation.builder.fields.key")}</span><input className={`${inputCls} mt-1`} dir="ltr" value={key} disabled={!!id} onChange={(e) => setKey(e.target.value.toLowerCase())} data-testid="auto-key" placeholder="winback-2-steps" /></label>
              <label className={field}><span className="font-medium">{t("growth.automation.builder.fields.name")}</span><input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} data-testid="auto-name" maxLength={120} /></label>
              <label className={field}><span className="font-medium">{t("growth.automation.builder.fields.trigger")}</span><select className={`${selectCls} mt-1 w-full`} value={model.trigger} onChange={(e) => setModel({ ...model, trigger: e.target.value })} data-testid="auto-trigger">{(cat.data?.triggers ?? []).map((x) => <option key={x} value={x}>{t(`growth.automation.trigger.${x}`)}</option>)}</select></label>
            </div>
          </Section>
          <Section title={t("growth.automation.builder.steps")} id="auto-steps-title" hint={t("growth.automation.builder.exits")}>
            <ol className="space-y-3" data-testid="auto-steps">
              {model.steps.map((s, i) => (
                <li key={i} className="rounded-xl border bg-card p-3" data-testid={`auto-step-${i}`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{i + 1}. {s.kind === "WAIT" ? t("growth.automation.builder.addWait") : s.kind === "CONDITION" ? t("growth.automation.builder.addCondition") : t("growth.automation.builder.addSend")}</strong>
                    <span className="flex gap-1"><button className={`${btnCls} w-11 px-0`} aria-label={t("growth.automation.builder.up")} onClick={() => move(i, -1)} disabled={i === 0}>↑</button><button className={`${btnCls} w-11 px-0`} aria-label={t("growth.automation.builder.down")} onClick={() => move(i, 1)} disabled={i === model.steps.length - 1}>↓</button>
                      <button className={btnCls} onClick={() => setModel({ ...model, steps: model.steps.filter((_, k) => k !== i) })} data-testid={`auto-remove-${i}`}>{t("growth.automation.builder.remove")}</button></span></div>
                  {s.kind === "WAIT" && (<div className="flex flex-wrap items-end gap-2"><label className={field}><span className="font-medium">{t("growth.automation.builder.wait")}</span><input type="number" min={1} className={`${inputCls} mt-1 w-28`} value={s.value} onChange={(e) => set(i, { ...s, value: Number(e.target.value) })} data-testid={`auto-wait-value-${i}`} /></label>
                    <select className={selectCls} aria-label={t("growth.automation.builder.wait")} value={s.unit} onChange={(e) => set(i, { ...s, unit: e.target.value as "minutes" | "hours" | "days" })} data-testid={`auto-wait-unit-${i}`}>{(["minutes", "hours", "days"] as const).map((u) => <option key={u} value={u}>{t(`growth.automation.unit.${u}`)}</option>)}</select>
                    <p className="text-xs text-muted-foreground">{t("growth.automation.builder.waitHint")}</p></div>)}
                  {s.kind === "CONDITION" && (<div className="space-y-2"><p className="text-xs text-muted-foreground">{t("growth.automation.builder.conditionHint")}</p>
                    <fieldset><legend className="text-sm font-medium">{t("growth.automation.builder.attr.stage")}</legend><div className="mt-1 flex flex-wrap gap-2">{STAGES.map((x) => <label key={x} className="inline-flex h-11 items-center gap-2 rounded-xl border px-3 text-sm"><input type="checkbox" checked={s.stage.includes(x)} onChange={() => set(i, { ...s, stage: toggle(s.stage, x) })} /> {x}</label>)}</div></fieldset>
                    <fieldset><legend className="text-sm font-medium">{t("growth.automation.builder.attr.language")}</legend><div className="mt-1 flex flex-wrap gap-2">{["ar", "en"].map((x) => <label key={x} className="inline-flex h-11 items-center gap-2 rounded-xl border px-3 text-sm"><input type="checkbox" checked={s.language.includes(x)} onChange={() => set(i, { ...s, language: toggle(s.language, x) })} data-testid={`auto-cond-lang-${x}-${i}`} /> {x}</label>)}</div></fieldset>
                    <fieldset><legend className="text-sm font-medium">{t("growth.automation.builder.attr.platform")}</legend><div className="mt-1 flex flex-wrap gap-2">{["web", "ios", "android"].map((x) => <label key={x} className="inline-flex h-11 items-center gap-2 rounded-xl border px-3 text-sm"><input type="checkbox" checked={s.platform.includes(x)} onChange={() => set(i, { ...s, platform: toggle(s.platform, x) })} /> {x}</label>)}</div></fieldset>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className={field}><span className="font-medium">{t("growth.automation.builder.attr.hasDependants")}</span><select className={`${selectCls} mt-1 w-full`} value={s.hasDependants} onChange={(e) => set(i, { ...s, hasDependants: e.target.value as "" | "yes" | "no" })}><option value="">{t("growth.automation.builder.attr.any")}</option><option value="yes">{t("growth.automation.builder.attr.yes")}</option><option value="no">{t("growth.automation.builder.attr.no")}</option></select></label>
                      <label className={field}><span className="font-medium">{t("growth.automation.builder.attr.lastBooking")}: {t("growth.automation.builder.attr.min")}</span><input type="number" min={0} className={`${inputCls} mt-1`} value={s.lastBookingMin} onChange={(e) => set(i, { ...s, lastBookingMin: e.target.value })} /></label>
                      <label className={field}><span className="font-medium">{t("growth.automation.builder.attr.lastBooking")}: {t("growth.automation.builder.attr.max")}</span><input type="number" min={0} className={`${inputCls} mt-1`} value={s.lastBookingMax} onChange={(e) => set(i, { ...s, lastBookingMax: e.target.value })} /></label></div></div>)}
                  {s.kind === "SEND" && (<div className="space-y-2"><label className={field}><span className="font-medium">{t("growth.automation.builder.send")}</span><select className={`${selectCls} mt-1 w-full`} value={s.template} onChange={(e) => set(i, { ...s, template: e.target.value, channels: [] })} data-testid={`auto-send-template-${i}`}>{(cat.data?.templates ?? []).map((x) => <option key={x.key} value={x.key}>{t(`growth.automation.template.${x.key}`)} ({t(`growth.automation.class.${x.messageClass}`)})</option>)}</select></label>
                    <fieldset><legend className="text-sm font-medium">{t("growth.automation.builder.channels")}</legend><p className="text-xs text-muted-foreground">{t("growth.automation.builder.channelsHint")}</p><div className="mt-1 flex flex-wrap gap-2">{chans(s.template).map((c) => <label key={c} className="inline-flex h-11 items-center gap-2 rounded-xl border px-3 text-sm"><input type="checkbox" checked={s.channels.includes(c)} onChange={() => set(i, { ...s, channels: toggle(s.channels, c) })} data-testid={`auto-send-ch-${c}-${i}`} /> {t(`growth.automation.channel.${c}`)}</label>)}</div></fieldset>
                    {cls(s.template) === "MARKETING" && <p className="rounded-xl border border-dashed p-2 text-xs" data-testid={`auto-gate-note-${i}`}><strong>{t("growth.automation.builder.gate")}</strong><br />{t("growth.automation.builder.gateChecks")}</p>}</div>)}
                </li>
              ))}
            </ol>
            {!model.split && (
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("growth.automation.builder.add")}>
                <button className={btnCls} onClick={() => setModel({ ...model, steps: [...model.steps, newStep("WAIT")] })} data-testid="auto-add-wait">{t("growth.automation.builder.addWait")}</button>
                <button className={btnCls} onClick={() => setModel({ ...model, steps: [...model.steps, newStep("CONDITION")] })} data-testid="auto-add-condition">{t("growth.automation.builder.addCondition")}</button>
                <button className={btnCls} onClick={() => setModel({ ...model, steps: [...model.steps, newStep("SEND")] })} data-testid="auto-add-send">{t("growth.automation.builder.addSend")}</button>
                <button className={btnCls} onClick={() => setModel({ ...model, split: { experiment: "", arms: [{ variant: "control", template: "REENGAGE_DORMANT", channels: [] }, { variant: "", template: "REENGAGE_DORMANT", channels: [] }] } })} data-testid="auto-add-split">{t("growth.automation.builder.addSplit")}</button>
              </div>)}
            {model.split && (
              <div className="mt-3 space-y-2 rounded-xl border p-3" data-testid="auto-split">
                <p className="text-sm font-semibold">{t("growth.automation.builder.split")}</p><p className="text-xs text-muted-foreground">{t("growth.automation.builder.splitHint")}</p>
                <label className={field}><span className="font-medium">{t("growth.automation.builder.experiment")}</span><input className={`${inputCls} mt-1`} dir="ltr" value={model.split.experiment} onChange={(e) => setModel({ ...model, split: { ...model.split!, experiment: e.target.value } })} data-testid="auto-split-experiment" /></label>
                {model.split.arms.map((a, k) => (
                  <div key={k} className="grid gap-2 sm:grid-cols-2" data-testid={`auto-arm-${k}`}>
                    <label className={field}><span className="font-medium">{t("growth.automation.builder.variant")}</span><input className={`${inputCls} mt-1`} dir="ltr" value={a.variant} disabled={k === 0} onChange={(e) => setModel({ ...model, split: { ...model.split!, arms: model.split!.arms.map((x, n) => (n === k ? { ...x, variant: e.target.value } : x)) } })} /></label>
                    <label className={field}><span className="font-medium">{t("growth.automation.builder.send")}</span><select className={`${selectCls} mt-1 w-full`} value={a.template} onChange={(e) => setModel({ ...model, split: { ...model.split!, arms: model.split!.arms.map((x, n) => (n === k ? { ...x, template: e.target.value, channels: [] } : x)) } })}>{(cat.data?.templates ?? []).map((x) => <option key={x.key} value={x.key}>{t(`growth.automation.template.${x.key}`)}</option>)}</select></label>
                  </div>))}
                <button className={btnCls} onClick={() => setModel({ ...model, split: null })} data-testid="auto-remove-split">{t("growth.automation.builder.removeSplit")}</button>
              </div>)}
          </Section>
          <div className="flex flex-wrap items-center gap-3">
            <button className={primaryBtnCls} onClick={save} disabled={!graph || (!id && !key) || errors.length > 0 || acts.create.isPending || acts.update.isPending} data-testid="auto-save">{t("growth.automation.builder.save")}</button>
            <span role="status" className="text-sm" data-testid="auto-check-state">{acts.validate.isPending ? t("growth.automation.builder.validating") : check?.valid ? t("growth.automation.builder.valid") : ""}</span>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm" data-testid="auto-errors"><p className="font-semibold">{t("growth.automation.builder.invalid")}</p>
          <ul className="mt-1 list-disc space-y-1 ps-5">{errors.map((e, k) => <li key={k} data-testid={`auto-error-${e.code}`}>{t(`growth.automation.vcode.${e.code}`, { defaultValue: e.message })} <span dir="ltr" className="text-xs text-muted-foreground">{e.path}</span></li>)}</ul></div>)}
      {msg && <p role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm" data-testid="auto-error">{msg}</p>}

      {graph && <Section title={t("growth.automation.builder.preview")} id="auto-flow-title"><FlowView graph={graph} catalog={cat.data} /><p className="mt-3 text-xs text-muted-foreground">{t("growth.automation.builder.exits")}</p></Section>}

      {j && (
        <Section title={t("growth.automation.detail.actions")} id="auto-actions-title">
          {!can ? <p className="text-sm text-muted-foreground">{t("growth.automation.builder.needsRole")}</p> : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {j.status === "DRAFT" && <button className={btnCls} onClick={() => run(acts.submit, j.id)} data-testid="auto-submit">{t("growth.automation.detail.submit")}</button>}
                {j.status === "PENDING_APPROVAL" && <button className={btnCls} onClick={() => run(acts.approve, j.id)} data-testid="auto-approve">{t("growth.automation.detail.approve")}</button>}
                {j.status === "PENDING_APPROVAL" && <button className={btnCls} onClick={() => run(acts.reject, { id: j.id, reason: note || "-" })} data-testid="auto-reject">{t("growth.automation.detail.reject")}</button>}
                {j.status === "PUBLISHED" && <button className={btnCls} onClick={() => run(acts.retire, j.id)} data-testid="auto-retire">{t("growth.automation.detail.retire")}</button>}
              </div>
              {j.status === "PENDING_APPROVAL" && <p className="text-xs text-muted-foreground">{t("growth.automation.detail.approveHint")}</p>}
              {j.status === "PUBLISHED" && !j.killedAt && (
                <div className="space-y-2"><label className={field}><span className="font-medium">{t("growth.automation.detail.killReason")}</span><input className={`${inputCls} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} data-testid="auto-kill-reason" /></label>
                  <p className="text-xs text-muted-foreground">{t("growth.automation.detail.killHint")}</p>
                  <button className={btnCls} disabled={note.trim().length < 3} onClick={() => run(acts.kill, { id: j.id, reason: note.trim() })} data-testid="auto-kill">{t("growth.automation.detail.killConfirm")}</button></div>)}
            </div>)}
        </Section>)}

      {j && (
        <Section title={t("growth.automation.detail.runs")} hint={t("growth.automation.detail.runsHint")} id="auto-runs-title">
          <p className="mb-2 text-sm" data-testid="auto-active">{t("growth.automation.detail.active", { n: j.activeEnrolments })}</p>
          {j.runLog.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : (
            <ul className="space-y-2" data-testid="auto-runlog">{j.runLog.map((r) => <li key={r.day} className="rounded-xl border bg-card p-3 text-sm"><span dir="ltr" className="font-semibold">{r.day}</span><dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4"><div><dt className="text-muted-foreground">{t("growth.automation.detail.col.enrolled")}</dt><dd>{r.enrolled}</dd></div><div><dt className="text-muted-foreground">{t("growth.automation.detail.col.sent")}</dt><dd>{r.sent}</dd></div><div><dt className="text-muted-foreground">{t("growth.automation.detail.col.skipped")}</dt><dd>{r.skipped}</dd></div><div><dt className="text-muted-foreground">{t("growth.automation.detail.col.ended")}</dt><dd>{r.ended}</dd></div></dl></li>)}</ul>)}
        </Section>)}
    </GrowthPage>
  );
}
