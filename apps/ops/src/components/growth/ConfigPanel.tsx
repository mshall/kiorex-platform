import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, GitCompare, History, Pencil, RotateCcw, Send, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/api/errors";
import { useConfigAction, useConfigDetail, useConfigDiff, useConfigKinds, useConfigValidate, useConfigVersions, useGrowthAccess, useInForce, usePropagation, type ConfigKindInfo, type ConfigStatus, type ConfigVersion } from "@/api/growth";
import { useAuth } from "@/auth/AuthProvider";
import { StatusChip, FormField, type Tone } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { formatDateTime, localToIso } from "@/lib/format";
import { SchemaForm } from "./SchemaForm";
import { Section, selectCls } from "./GrowthPage";

const STATUS_TONE: Record<ConfigStatus, Tone> = { DRAFT: "neutral", PENDING_APPROVAL: "warning", APPROVED: "info", ACTIVE: "success", SUPERSEDED: "neutral", REJECTED: "danger", ROLLED_BACK: "neutral" };
const DAY = 86_400_000;
/** The materialised code default starts at the epoch: that is "from the beginning", not a date to show. */
const when = (iso: string | null, lang: string) => (!iso || new Date(iso).getFullYear() < 2000 ? "—" : formatDateTime(iso, lang));
/** Passport subjects are 26-character ids: show the tail, keep the whole id in the tooltip. */
const who = (s: string | null) => (!s ? "—" : /^[0-9A-Z]{26}$/.test(s) ? <span title={s} className="kx-label-num">…{s.slice(-8)}</span> : <span title={s}>{s}</span>);
const eightDays = () => toLocalInput(new Date(Date.now() + 8 * DAY));
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ErrorList({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const list = (e?.details?.errors as string[] | undefined) ?? [];
  return (
    <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="config-errors">
      <p className="font-semibold text-destructive">{e ? `${e.code}: ${e.message}` : t("states.errorTitle")}</p>
      {list.length > 0 && <ul className="mt-1 list-disc ps-5">{list.map((x) => <li key={x} dir="auto">{x}</li>)}</ul>}
    </div>
  );
}

/** Plain list of a payload (what a version says), arrays and booleans in words. */
export function PayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  const { t } = useTranslation();
  const show = (v: unknown): string => (v === true ? t("growth.common.yes") : v === false ? t("growth.common.no") : v === null ? "—" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (<dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 xl:grid-cols-3" data-testid="payload-summary">{Object.entries(payload).map(([k, v]) => <div key={k} className="flex min-w-0 justify-between gap-3 border-b border-border/50 py-1"><dt className="truncate text-muted-foreground"><code className="text-xs">{k}</code></dt><dd className="kx-label-num min-w-0 break-words text-end font-medium" dir="auto">{show(v)}</dd></div>)}</dl>);
}

function ReviewDialog({ id, onClose, canDecide, me, onDecision }: { id: string; onClose: () => void; canDecide: boolean; me: string | undefined; onDecision: () => void }) {
  const { t, i18n } = useTranslation();
  const diff = useConfigDiff(id); const val = useConfigValidate(id); const detail = useConfigDetail(id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="review-dialog">
        <DialogHeader><DialogTitle>{t("growth.config.review", { version: detail.data?.version ?? "" })}</DialogTitle><DialogDescription>{diff.data ? (diff.data.againstIsDefault ? t("growth.config.againstDefault") : t("growth.config.against", { version: diff.data.against?.version })) : ""}</DialogDescription></DialogHeader>
        <section aria-labelledby="rv-diff"><h3 id="rv-diff" className="mb-1 flex items-center gap-2 text-base"><GitCompare className="h-4 w-4" aria-hidden="true" />{t("growth.config.diff")}</h3>
          {diff.isLoading ? <CardSkeleton rows={1} /> : diff.data && diff.data.changes.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="diff-empty">{t("growth.config.noChanges")}</p> : (
            <ul className="space-y-1 text-sm" data-testid="diff-list">{diff.data?.changes.map((c) => <li key={c.path} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5"><code className="text-xs">{c.path}</code><StatusChip tone={c.kind === "added" ? "success" : c.kind === "removed" ? "danger" : "info"}>{t(`growth.config.diffKind.${c.kind}`)}</StatusChip><span className="kx-label-num" dir="auto">{c.kind !== "added" && <s className="text-muted-foreground">{JSON.stringify(c.before)}</s>} {c.kind !== "removed" && <b>{JSON.stringify(c.after)}</b>}</span></li>)}</ul>)}
        </section>
        <section aria-labelledby="rv-val"><h3 id="rv-val" className="mb-1 flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" aria-hidden="true" />{t("growth.config.checks")}</h3>
          {val.data && (<div className="space-y-1 text-sm" data-testid="validate-result"><StatusChip tone={val.data.valid ? "success" : "danger"}>{val.data.valid ? t("growth.config.valid") : t("growth.config.invalid")}</StatusChip>
            {val.data.errors.map((e) => <p key={e} role="alert" className="text-destructive" dir="auto">{e}</p>)}{val.data.warnings.map((w) => <p key={w} className="text-warning" dir="auto">{w}</p>)}</div>)}
        </section>
        <section aria-labelledby="rv-audit"><h3 id="rv-audit" className="mb-1 flex items-center gap-2 text-base"><History className="h-4 w-4" aria-hidden="true" />{t("growth.config.trail")}</h3>
          <ol className="space-y-1 text-sm" data-testid="trail">{detail.data?.audit.map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2"><code className="text-xs">{a.action}</code><span className="text-muted-foreground">{a.actor} · {formatDateTime(a.createdAt, i18n.language)}</span></li>)}</ol>
        </section>
        {detail.data?.status === "PENDING_APPROVAL" && (
          <DialogFooter className="gap-2 sm:justify-between">
            {canDecide && detail.data.createdBy === me ? <p className="text-sm text-muted-foreground" data-testid="self-note">{t("growth.config.secondAdmin")}</p> : <span />}
            <Button variant="outline" onClick={onClose}>{t("growth.common.close")}</Button>
            {canDecide && detail.data.createdBy !== me && <Button onClick={onDecision} data-testid="review-decide">{t("growth.config.decide")}</Button>}
          </DialogFooter>)}
      </DialogContent>
    </Dialog>
  );
}

function VersionDialog({ info, scope, scopeId, base, edit, onClose }: { info: ConfigKindInfo; scope: "GLOBAL" | "MARKET"; scopeId: string; base: Record<string, unknown>; edit: ConfigVersion | null; onClose: () => void }) {
  const { t } = useTranslation(); const act = useConfigAction();
  const [payload, setPayload] = useState<Record<string, unknown>>(edit?.payload ?? base);
  const [effective, setEffective] = useState(() => (edit?.effectiveFrom ? toLocalInput(new Date(edit.effectiveFrom)) : info.moneyPolicy ? eightDays() : ""));
  const [ticket, setTicket] = useState(edit?.ticket ?? ""); const [reason, setReason] = useState(edit?.reason ?? ""); const [announcement, setAnnouncement] = useState(edit?.announcement ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = { payload, effectiveFrom: localToIso(effective), ticket: ticket.trim() || undefined, reason: reason.trim() || undefined, announcement: announcement.trim() || undefined };
    act.mutate(edit ? { op: "update", id: edit.id, body } : { op: "create", body: { kind: info.kind, scope, ...(scope === "MARKET" ? { scopeId } : {}), ...body } }, { onSuccess: () => { toast.success(t("growth.config.saved")); onClose(); } });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto" data-testid="version-dialog">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader><DialogTitle>{edit ? t("growth.config.editDraft", { version: edit.version }) : t("growth.config.newVersion")} <code className="text-sm">{info.kind}</code></DialogTitle><DialogDescription>{info.moneyPolicy ? t("growth.config.moneyNote") : t("growth.config.draftNote")}</DialogDescription></DialogHeader>
          <SchemaForm schema={info.schema} value={payload} onChange={setPayload} idPrefix={`cfg-${info.kind}`} />
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label={t("growth.config.effectiveFrom")} hint={info.moneyPolicy ? t("growth.config.effectiveHintMoney") : t("growth.config.effectiveHint")} required={info.moneyPolicy}><Input type="datetime-local" value={effective} onChange={(e) => setEffective(e.target.value)} data-testid="cfg-effective" /></FormField>
            <FormField label={t("growth.config.ticket")} hint={t("growth.config.ticketHint")}><Input dir="ltr" maxLength={200} value={ticket} onChange={(e) => setTicket(e.target.value)} data-testid="cfg-ticket" /></FormField>
            <FormField label={t("growth.config.reason")} className="md:col-span-2"><Input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="cfg-reason" /></FormField>
            {info.moneyPolicy && <FormField label={t("growth.config.announcement")} hint={t("growth.config.announcementHint")} required className="md:col-span-2"><Textarea rows={3} maxLength={1000} value={announcement} onChange={(e) => setAnnouncement(e.target.value)} data-testid="cfg-announcement" /></FormField>}
          </div>
          {act.error && <ErrorList error={act.error} />}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t("growth.common.cancel")}</Button><Button type="submit" disabled={act.isPending} data-testid="cfg-save">{t("growth.config.saveDraft")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({ id, mode, onClose }: { id: string; mode: "approve" | "reject"; onClose: () => void }) {
  const { t } = useTranslation(); const act = useConfigAction(); const [reason, setReason] = useState("");
  const go = (e: FormEvent) => { e.preventDefault(); act.mutate(mode === "approve" ? { op: "approve", id } : { op: "reject", id, reason }, { onSuccess: () => { toast.success(t(mode === "approve" ? "growth.config.approved" : "growth.config.rejected")); onClose(); } }); };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="decide-dialog"><form onSubmit={go} className="space-y-4">
        <DialogHeader><DialogTitle>{t(mode === "approve" ? "growth.config.approveTitle" : "growth.config.rejectTitle")}</DialogTitle><DialogDescription>{t(mode === "approve" ? "growth.config.approveBody" : "growth.config.rejectBody")}</DialogDescription></DialogHeader>
        {mode === "reject" && <FormField label={t("growth.config.reason")} required><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} data-testid="reject-reason" /></FormField>}
        {act.error && <ErrorList error={act.error} />}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t("growth.common.cancel")}</Button><Button type="submit" variant={mode === "approve" ? "default" : "destructive"} disabled={act.isPending || (mode === "reject" && reason.trim().length < 3)} data-testid="decide-confirm">{t(mode === "approve" ? "growth.config.approve" : "growth.config.reject")}</Button></DialogFooter>
      </form></DialogContent>
    </Dialog>
  );
}

function RollbackDialog({ info, row, onClose }: { info: ConfigKindInfo; row: ConfigVersion; onClose: () => void }) {
  const { t } = useTranslation(); const act = useConfigAction();
  const [reason, setReason] = useState(""); const [announcement, setAnnouncement] = useState("");
  const [effective, setEffective] = useState(() => (info.moneyPolicy ? eightDays() : ""));
  const go = (e: FormEvent) => { e.preventDefault(); act.mutate({ op: "rollback", body: { kind: row.kind, scope: row.scope, ...(row.scope === "MARKET" ? { scopeId: row.scopeId } : {}), toVersion: row.version, reason, effectiveFrom: localToIso(effective), announcement: announcement.trim() || undefined } }, { onSuccess: () => { toast.success(t("growth.config.rollbackCreated")); onClose(); } }); };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="rollback-dialog"><form onSubmit={go} className="space-y-4">
        <DialogHeader><DialogTitle>{t("growth.config.rollbackTitle", { version: row.version })}</DialogTitle><DialogDescription>{t("growth.config.rollbackBody")}</DialogDescription></DialogHeader>
        <FormField label={t("growth.config.reason")} required><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} data-testid="rollback-reason" /></FormField>
        <FormField label={t("growth.config.effectiveFrom")} hint={info.moneyPolicy ? t("growth.config.effectiveHintMoney") : t("growth.config.effectiveHint")}><Input type="datetime-local" value={effective} onChange={(e) => setEffective(e.target.value)} /></FormField>
        {info.moneyPolicy && <FormField label={t("growth.config.announcement")} required><Textarea rows={3} value={announcement} onChange={(e) => setAnnouncement(e.target.value)} maxLength={1000} /></FormField>}
        {act.error && <ErrorList error={act.error} />}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t("growth.common.cancel")}</Button><Button type="submit" disabled={act.isPending || reason.trim().length < 3} data-testid="rollback-confirm">{t("growth.config.rollbackConfirm")}</Button></DialogFooter>
      </form></DialogContent>
    </Dialog>
  );
}

/**
 * Versioned configuration of one kind (draft, validate, submit, approve by a second super admin, effective date, rollback, diff, propagation).
 * `market` is the market whose version is shown; a MARKET_GROWTH kind always works at MARKET scope.
 */
export function ConfigPanel({ kind, market, showScopePicker = false }: { kind: string; market: string; showScopePicker?: boolean }) {
  const { t, i18n } = useTranslation(); const { user } = useAuth();
  const access = useGrowthAccess().data?.capabilities; const kinds = useConfigKinds();
  const info = kinds.data?.find((k) => k.kind === kind);
  const [scopeChoice, setScopeChoice] = useState<"GLOBAL" | "MARKET">(kind === "MARKET_GROWTH" ? "MARKET" : "GLOBAL");
  const scope = kind === "MARKET_GROWTH" ? "MARKET" : showScopePicker ? scopeChoice : "GLOBAL"; const scopeId = scope === "MARKET" ? market : "";
  const versions = useConfigVersions({ kind, scope, scopeId }); const inForce = useInForce(kind, market); const prop = usePropagation(kind, scope, scopeId);
  const act = useConfigAction();
  const [editor, setEditor] = useState<{ edit: ConfigVersion | null } | null>(null); const [review, setReview] = useState<string | null>(null); const [decide, setDecide] = useState<{ id: string; mode: "approve" | "reject" } | null>(null); const [rollback, setRollback] = useState<ConfigVersion | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const run = (a: Parameters<typeof act.mutate>[0], okKey: string) => { setActionError(null); act.mutate(a, { onSuccess: () => toast.success(t(okKey)), onError: (e) => setActionError(e) }); };
  const base = useMemo(() => inForce.data?.payload ?? info?.defaults ?? {}, [inForce.data, info]);
  if (kinds.isLoading || versions.isLoading || inForce.isLoading) return <CardSkeleton rows={2} />;
  if (kinds.error || versions.error || inForce.error || !info) return <ErrorState error={kinds.error ?? versions.error ?? inForce.error} onRetry={() => { void kinds.refetch(); void versions.refetch(); void inForce.refetch(); }} />;
  const iF = inForce.data!; const rows = versions.data ?? []; const activeId = rows.find((r) => r.status === "ACTIVE")?.id;
  const me = user?.sub;
  const rowActions = (r: ConfigVersion) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="ghost" onClick={() => setReview(r.id)} data-testid={`cfg-review-${r.version}`}><GitCompare aria-hidden="true" />{t("growth.config.diff")}</Button>
      {r.status === "DRAFT" && access?.writeConfig && r.createdBy === me && <><Button size="sm" variant="outline" onClick={() => setEditor({ edit: r })} data-testid={`cfg-edit-${r.version}`}><Pencil aria-hidden="true" />{t("growth.config.edit")}</Button><Button size="sm" onClick={() => run({ op: "submit", id: r.id }, "growth.config.submitted")} disabled={act.isPending} data-testid={`cfg-submit-${r.version}`}><Send aria-hidden="true" />{t("growth.config.submit")}</Button></>}
      {r.status === "PENDING_APPROVAL" && access?.approveConfig && (r.createdBy === me
        ? <span className="text-xs text-muted-foreground" data-testid={`cfg-wait-${r.version}`}>{t("growth.config.secondAdmin")}</span>
        : <><Button size="sm" onClick={() => setDecide({ id: r.id, mode: "approve" })} data-testid={`cfg-approve-${r.version}`}><Check aria-hidden="true" />{t("growth.config.approve")}</Button><Button size="sm" variant="outline" onClick={() => setDecide({ id: r.id, mode: "reject" })} data-testid={`cfg-reject-${r.version}`}><X aria-hidden="true" />{t("growth.config.reject")}</Button></>)}
      {r.status === "APPROVED" && <StatusChip tone="info" data-testid={`cfg-scheduled-${r.version}`}>{t("growth.config.activatesAt", { at: formatDateTime(r.effectiveFrom, i18n.language) })}</StatusChip>}
      {["ACTIVE", "SUPERSEDED", "ROLLED_BACK"].includes(r.status) && r.id !== activeId && access?.writeConfig && <Button size="sm" variant="outline" onClick={() => setRollback(r)} data-testid={`cfg-rollback-${r.version}`}><RotateCcw aria-hidden="true" />{t("growth.config.rollback")}</Button>}
    </div>
  );
  return (
    <div className="space-y-4" data-testid={`config-panel-${kind}`}>
      {showScopePicker && kind !== "MARKET_GROWTH" && <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t("growth.config.scope")}</span><select className={selectCls} value={scopeChoice} onChange={(e) => setScopeChoice(e.target.value as "GLOBAL" | "MARKET")}><option value="GLOBAL">{t("growth.config.scopeGlobal")}</option><option value="MARKET">{t("growth.config.scopeMarket", { market })}</option></select></label>}
      <Section title={t("growth.config.inForce")} id={`inforce-${kind}`} hint={info.note}>
        <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="in-force">
          <StatusChip tone={iF.source === "ACTIVE" ? "success" : "warning"} data-testid="in-force-source">{iF.source === "ACTIVE" ? t("growth.config.activeVersion", { version: iF.version }) : t("growth.config.proposedDefault")}</StatusChip>
          {iF.source === "PROPOSED_DEFAULT" && <span className="text-xs text-muted-foreground">{t("growth.config.proposedNote")}</span>}
          {iF.effectiveFrom && iF.source === "ACTIVE" && <span className="text-xs text-muted-foreground">{t("growth.config.since", { at: formatDateTime(iF.effectiveFrom, i18n.language) })}</span>}
          <span className="text-xs text-muted-foreground">{iF.scope === "MARKET" ? t("growth.config.scopeMarket", { market: iF.scopeId }) : t("growth.config.scopeGlobal")}</span>
          {info.moneyPolicy && <StatusChip tone="brand">{t("growth.config.moneyChip")}</StatusChip>}
        </div>
        <PayloadSummary payload={iF.payload} />
        {iF.scheduled.length > 0 && <p className="mt-3 text-sm" data-testid="scheduled-note">{iF.scheduled.map((s) => t("growth.config.scheduledLine", { version: s.version, at: formatDateTime(s.effectiveFrom, i18n.language) })).join(" · ")}</p>}
        {prop.data && (
          <div className="mt-3 rounded-xl bg-muted/50 p-3 text-sm" data-testid="propagation">
            <div className="flex flex-wrap items-center gap-2"><b>{t("growth.config.propagation")}</b>
              <StatusChip tone={prop.data.converged === null ? "neutral" : prop.data.converged ? "success" : "warning"}>{prop.data.converged === null ? t("growth.config.noReaders") : prop.data.converged ? t("growth.config.converged", { n: prop.data.liveReaders }) : t("growth.config.stale", { n: prop.data.stale })}</StatusChip>
              <span className="text-xs text-muted-foreground">{t("growth.config.cacheTtl", { s: Math.round(prop.data.cacheTtlMs / 1000) })}</span></div>
            {prop.data.readers.length > 0 && <ul className="mt-2 space-y-0.5 text-xs">{prop.data.readers.map((r) => <li key={`${r.instanceId}-${r.reader}`} className="flex flex-wrap justify-between gap-2"><code>{r.instanceId} · {r.reader}</code><span>{t("growth.config.readerVersion", { version: r.version })} · {r.live ? (r.upToDate ? t("growth.config.upToDate") : t("growth.config.behind")) : t("growth.config.idle")}</span></li>)}</ul>}
          </div>)}
      </Section>
      <Section title={t("growth.config.versions")} id={`versions-${kind}`} className="overflow-hidden"
        hint={access?.writeConfig ? t("growth.config.makerHint") : t("growth.config.readOnlyHint")}>
        {access?.writeConfig && <div className="mb-3"><Button onClick={() => setEditor({ edit: null })} data-testid="cfg-new"><Pencil aria-hidden="true" />{t("growth.config.newVersion")}</Button></div>}
        {actionError ? <div className="mb-3"><ErrorList error={actionError} /></div> : null}
        <DataTable caption={t("growth.config.versions")} rows={rows} rowKey={(r) => r.id} empty={t("growth.config.noVersions")} columns={[
          { key: "v", header: t("growth.config.colVersion"), cell: (r) => <b className="kx-label-num">v{r.version}</b> },
          { key: "s", header: t("growth.config.colStatus"), cell: (r) => <StatusChip tone={STATUS_TONE[r.status]} data-testid={`cfg-status-${r.version}`}>{t(`growth.config.status.${r.status}`)}</StatusChip> },
          { key: "e", header: t("growth.config.effectiveFrom"), cell: (r) => <span className="kx-label-num text-xs">{when(r.effectiveFrom, i18n.language)}</span> },
          { key: "m", header: t("growth.config.colMaker"), cell: (r) => <span className="text-xs">{who(r.createdBy)}</span> },
          { key: "c", header: t("growth.config.colChecker"), cell: (r) => <span className="text-xs">{who(r.approvedBy)}</span> },
          { key: "t", header: t("growth.config.ticket"), cell: (r) => <span className="text-xs" dir="auto">{r.ticket ?? r.reason ?? "—"}</span> },
          { key: "a", header: t("growth.common.actions"), cell: rowActions },
        ]} />
      </Section>
      {editor && <VersionDialog info={info} scope={scope} scopeId={scopeId} base={base} edit={editor.edit} onClose={() => setEditor(null)} />}
      {review && <ReviewDialog id={review} me={me} canDecide={!!access?.approveConfig} onClose={() => setReview(null)} onDecision={() => { const id = review; setReview(null); setDecide({ id, mode: "approve" }); }} />}
      {decide && <DecideDialog id={decide.id} mode={decide.mode} onClose={() => setDecide(null)} />}
      {rollback && <RollbackDialog info={info} row={rollback} onClose={() => setRollback(null)} />}
    </div>
  );
}
