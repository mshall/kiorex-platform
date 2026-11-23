import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileUp, GitMerge, ShieldCheck, Undo2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/auth/AuthProvider";
import { ApiError } from "@/api/errors";
import { useBatchAction, useDryRun, useImport, useImportAudit, useImportTasks, usePatientLookup, useResolve, useUploadFile, type ImportTask, type TaskAction } from "@/api/onboarding";
import { CardSkeleton, ErrorState } from "@/components/states";
import { PageHeader, StatCard, StatusChip, Stepper } from "@/components/kit";
import { formatDateTime } from "@/lib/format";
import { STATUS_TONE } from "./OnboardingPage";

const STEP_OF: Record<string, number> = { DRAFT: 0, NEEDS_REVIEW: 2, READY: 3, AWAITING_APPROVAL: 4, APPROVED: 4, COMMITTING: 5, COMMIT_FAILED: 5, COMMITTED: 6, ROLLING_BACK: 6, ROLLED_BACK: 6 };
const sel = "h-10 w-full rounded-lg border bg-background px-3 text-sm";

/** One resolution-queue task: what is wrong (masked context), the system's suggested fix, and the human actions. */
function TaskCard({ task, batchId, locked }: { task: ImportTask; batchId: string; locked: boolean }) {
  const { t } = useTranslation(); const resolve = useResolve(batchId);
  const [value, setValue] = useState<string>(String(task.suggestion?.value ?? "")); const [col, setCol] = useState<string>(String(task.suggestion?.candidates?.[0]?.column ?? task.context.proposed ?? "")); const [reason, setReason] = useState(""); const [keep, setKeep] = useState<string>(String(task.suggestion?.keep ?? "")); const [search, setSearch] = useState("");
  const lookup = usePatientLookup(batchId, search);
  const run = (action: TaskAction, params?: Record<string, unknown>) => resolve.mutate({ taskId: task.id, action, params, reason: action === "IGNORE" ? reason : undefined }, { onError: (e) => toast.error(e instanceof ApiError ? t(`onb.err.${e.code}`, { defaultValue: e.code }) : t("onb.err.generic")) });
  const can = (a: TaskAction) => task.actions.includes(a) && task.status === "OPEN" && !locked;
  const cands = (task.suggestion?.candidates ?? []) as Array<{ sourceKey?: string; name?: string; phone?: string; via?: string; column?: string; confidence?: number }>;
  const members = (task.context.members ?? []) as Array<{ sourceKey: string; name: string; phone: string; dob?: string }>;
  const ctxLine = task.type === "DUPLICATE_PATIENT" ? null : [task.context.field && `${t("onb.field")}: ${task.context.field}`, task.context.rowRef && `${t("onb.row")}: ${task.context.rowRef}`, task.context.name, task.context.value != null && `“${task.context.value}”`, task.context.reason, task.context.table && `${t("onb.table")}: ${task.context.table}`, task.context.affectedRows && `${task.context.affectedRows} ${t("onb.rows")}`].filter(Boolean).join(" · ");
  return (
    <li className="rounded-2xl border bg-card p-4" data-testid={`task-${task.type}`} data-status={task.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={task.severity === "BLOCKER" ? "destructive" : task.severity === "WARNING" ? "warning" : "info"}>{t(`onb.sev.${task.severity}`)}</Badge>
        <b>{t(`onb.task.${task.type}.title`, { defaultValue: task.type })}</b>
        {task.status !== "OPEN" && <StatusChip tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />{t(`onb.taskStatus.${task.status}`)}</StatusChip>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t(`onb.task.${task.type}.hint`, { defaultValue: "" })}</p>
      {ctxLine && <p className="mt-1 break-words text-sm" dir="auto">{ctxLine}</p>}
      {task.context.name && task.type.includes("FILE") && <p className="mt-1 text-sm" dir="auto"><FileUp className="inline h-4 w-4" aria-hidden="true" /> {task.context.name}</p>}
      {members.length > 0 && (
        <div role="radiogroup" aria-label={t("onb.keepWhich")} className="mt-2 grid gap-2 sm:grid-cols-2">
          {members.map((m) => (
            <label key={m.sourceKey} className="flex cursor-pointer items-start gap-2 rounded-xl border p-2 text-sm has-[:checked]:ring-2 has-[:checked]:ring-primary/40">
              <input type="radio" name={`keep-${task.id}`} checked={(keep || members[0].sourceKey) === m.sourceKey} onChange={() => setKeep(m.sourceKey)} disabled={!can("MERGE")} />
              <span dir="auto"><b>#{m.sourceKey}</b> {m.name}<br /><span className="text-xs text-muted-foreground" dir="ltr">{m.phone} {m.dob ?? ""}</span></span>
            </label>
          ))}
        </div>
      )}
      {task.suggestion?.options && <p className="mt-2 text-xs text-muted-foreground">{t("onb.suggested")}: {(task.suggestion.options as string[]).map((o) => <button key={o} type="button" className="me-1 rounded-md border px-1.5 py-0.5 text-foreground" dir="ltr" onClick={() => setValue(o)} disabled={!can("EDIT_VALUE")}>{o}</button>)}</p>}
      {task.suggestion?.value && <p className="mt-1 text-xs text-muted-foreground">{t("onb.suggested")}: <b dir="ltr">{String(task.suggestion.value)}</b></p>}
      {task.status === "OPEN" && !locked && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {can("EDIT_VALUE") && <div className="flex gap-2"><Input aria-label={t("onb.newValue")} className="w-48" dir="auto" value={value} onChange={(e) => setValue(e.target.value)} data-testid="task-value" /><Button size="sm" disabled={!value || resolve.isPending} onClick={() => run("EDIT_VALUE", { value })} data-testid="act-edit">{t("onb.act.EDIT_VALUE")}</Button></div>}
          {(can("MAP_COLUMN") || can("MAP_TABLE")) && (
            <div className="flex gap-2">
              <select aria-label={t("onb.pick")} className={sel} value={col} onChange={(e) => setCol(e.target.value)} data-testid="task-select">
                {can("MAP_TABLE") ? <>{["patients", "appointments", "visits", "billing", "documents"].map((e) => <option key={e} value={e}>{t(`onb.entity.${e}`)}</option>)}</> : ((task.context.columns as string[] | undefined) ?? cands.map((c) => c.column!)).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button size="sm" disabled={!col || resolve.isPending} onClick={() => (can("MAP_TABLE") ? run("MAP_TABLE", { entity: col }) : run("MAP_COLUMN", { column: col }))} data-testid="act-map">{t(can("MAP_TABLE") ? "onb.act.MAP_TABLE" : "onb.act.MAP_COLUMN")}</Button>
            </div>
          )}
          {can("MERGE") && <Button size="sm" onClick={() => run("MERGE", { keep: keep || members[0]?.sourceKey })} data-testid="act-merge"><GitMerge aria-hidden="true" />{t("onb.act.MERGE")}</Button>}
          {can("KEEP_BOTH") && <Button size="sm" variant="outline" onClick={() => run("KEEP_BOTH")} data-testid="act-keep-both">{t("onb.act.KEEP_BOTH")}</Button>}
          {(can("ASSIGN_FILE") || can("ASSIGN_PATIENT")) && (
            <div className="w-full space-y-2">
              {cands.some((c) => c.sourceKey) && <div className="flex flex-wrap gap-2">{cands.filter((c) => c.sourceKey).map((c) => <Button key={c.sourceKey} size="sm" variant="outline" onClick={() => run(can("ASSIGN_FILE") ? "ASSIGN_FILE" : "ASSIGN_PATIENT", { sourceKey: c.sourceKey })} data-testid={`assign-${c.sourceKey}`}><span dir="auto">#{c.sourceKey} {c.name}</span></Button>)}</div>}
              <div className="flex gap-2"><Input aria-label={t("onb.searchPatient")} placeholder={t("onb.searchPatient")} className="w-64" dir="auto" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="patient-search" /></div>
              {lookup.data && lookup.data.length > 0 && <ul className="flex flex-wrap gap-2">{lookup.data.map((p) => <li key={p.sourceKey}><Button size="sm" variant="secondary" onClick={() => run(can("ASSIGN_FILE") ? "ASSIGN_FILE" : "ASSIGN_PATIENT", { sourceKey: p.sourceKey })} data-testid={`pick-${p.sourceKey}`}><span dir="auto">#{p.sourceKey} {p.name}</span></Button></li>)}</ul>}
            </div>
          )}
          {can("ACCEPT_REPAIR") && <Button size="sm" onClick={() => run("ACCEPT_REPAIR")} data-testid="act-repair">{t("onb.act.ACCEPT_REPAIR")}</Button>}
          {can("CHOOSE_DATE_FORMAT") && <><Button size="sm" variant="outline" onClick={() => run("CHOOSE_DATE_FORMAT", { dayFirst: true })} data-testid="act-dayfirst">{t("onb.dayFirst")}</Button><Button size="sm" variant="outline" onClick={() => run("CHOOSE_DATE_FORMAT", { dayFirst: false })} data-testid="act-monthfirst">{t("onb.monthFirst")}</Button></>}
          {can("SKIP_FILE") && <Button size="sm" variant="outline" onClick={() => run("SKIP_FILE")} data-testid="act-skip-file">{t("onb.act.SKIP_FILE")}</Button>}
          {can("SKIP_ROW") && <Button size="sm" variant="outline" onClick={() => run("SKIP_ROW")} data-testid="act-skip-row">{t("onb.act.SKIP_ROW")}</Button>}
          {can("IGNORE") && <div className="flex gap-2"><Input aria-label={t("onb.ignoreReason")} placeholder={t("onb.ignoreReason")} className="w-56" dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="ignore-reason" /><Button size="sm" variant="ghost" disabled={reason.trim().length < 3} onClick={() => run("IGNORE")} data-testid="act-ignore">{t("onb.act.IGNORE")}</Button></div>}
        </div>
      )}
    </li>
  );
}

export default function OnboardingBatchPage() {
  const { id = "" } = useParams(); const { t, i18n } = useTranslation(); const { user } = useAuth();
  const b = useImport(id); const dry = useDryRun(id); const act = useBatchAction(id); const upload = useUploadFile(id); const audit = useImportAudit(id);
  const [f, setF] = useState({ status: "OPEN", severity: "", type: "", page: 1 }); const tasks = useImportTasks(id, f);
  const [busy, setBusy] = useState<string | null>(null); const fileRef = useRef<HTMLInputElement>(null); const [reason, setReason] = useState("");
  if (b.isLoading) return <CardSkeleton rows={4} />;
  if (b.error || !b.data) return <ErrorState error={b.error} onRetry={() => void b.refetch()} />;
  const bt = b.data; const st = bt.status; const locked = !["DRAFT", "NEEDS_REVIEW", "READY", "AWAITING_APPROVAL", "APPROVED"].includes(st);
  const isSuper = user?.roles.includes("super_admin"); const me = user?.sub;
  const errText = (e: unknown) => (e instanceof ApiError ? t(`onb.err.${e.code}`, { defaultValue: e.code }) : t("onb.err.generic"));
  const call = (path: Parameters<typeof act.mutate>[0]["path"], body?: unknown, ok?: string) => act.mutate({ path, body }, { onSuccess: () => ok && toast.success(ok), onError: (e) => toast.error(errText(e)) });
  const onFiles = async (list: FileList | null) => { if (!list) return; for (const file of Array.from(list)) { setBusy(file.name); try { const r = await upload.mutateAsync(file); if (r.kind === "REJECTED") toast.warning(t("onb.rejected", { reason: t(`onb.reject.${r.rejectReason}`, { defaultValue: r.rejectReason }) })); } catch (e) { toast.error(errText(e)); } } setBusy(null); if (fileRef.current) fileRef.current.value = ""; };
  const stats = bt.summary?.stats;
  return (
    <div>
      <PageHeader title={bt.orgName} hint={`${t("onb.orgId")}: ${bt.orgId}`} badge={<StatusChip tone={STATUS_TONE[st] ?? "neutral"} data-testid="batch-status">{t(`onb.st.${st}`)}</StatusChip>} />
      <Stepper className="mb-5" label={t("onb.steps.label")} current={STEP_OF[st] ?? 0} steps={["upload", "scan", "resolve", "dry", "approve", "commit"].map((s) => t(`onb.steps.${s}`))} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="onb-tiles">
        <StatCard label={t("onb.blockers")} value={stats?.blockers ?? 0} tone={stats?.blockers ? "danger" : "ok"} />
        <StatCard label={t("onb.warnings")} value={stats?.warnings ?? 0} tone={stats?.warnings ? "warn" : undefined} />
        <StatCard label={t("onb.patients")} value={stats?.rows.patients ?? 0} />
        <StatCard label={t("onb.filesMatched")} value={`${stats?.filesMatched ?? 0}/${stats?.filesTotal ?? 0}`} />
      </div>
      {!locked && (
        <section className="mb-4 rounded-2xl border border-dashed bg-card p-4" aria-label={t("onb.upload")}>
          <p className="text-sm text-muted-foreground">{t("onb.uploadHint")}</p>
          <input ref={fileRef} type="file" multiple className="sr-only" id="onb-files" accept=".sql,.csv,.tsv,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.heic,.tif,.tiff" onChange={(e) => void onFiles(e.target.files)} data-testid="onb-file-input" />
          <Button className="mt-2" variant="outline" onClick={() => fileRef.current?.click()} disabled={!!busy}><Upload aria-hidden="true" />{busy ? t("onb.scanning") : t("onb.chooseFiles")}</Button>
        </section>
      )}
      <Tabs defaultValue="tasks">
        <TabsList><TabsTrigger value="tasks" data-testid="tab-tasks">{t("onb.tab.tasks")}</TabsTrigger><TabsTrigger value="files">{t("onb.tab.files")}</TabsTrigger><TabsTrigger value="mapping">{t("onb.tab.mapping")}</TabsTrigger><TabsTrigger value="commit" data-testid="tab-commit">{t("onb.tab.commit")}</TabsTrigger><TabsTrigger value="audit">{t("onb.tab.audit")}</TabsTrigger></TabsList>
        <TabsContent value="tasks">
          <div className="mb-3 flex flex-wrap gap-2">
            <select aria-label={t("onb.status")} className={`${sel} w-40`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })}><option value="">{t("onb.all")}</option>{["OPEN", "RESOLVED", "IGNORED"].map((s) => <option key={s} value={s}>{t(`onb.taskStatus.${s}`)}</option>)}</select>
            <select aria-label={t("onb.severity")} className={`${sel} w-40`} value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value, page: 1 })}><option value="">{t("onb.all")}</option>{["BLOCKER", "WARNING", "INFO"].map((s) => <option key={s} value={s}>{t(`onb.sev.${s}`)}</option>)}</select>
          </div>
          {tasks.isLoading ? <CardSkeleton rows={3} /> : tasks.error ? <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} /> : tasks.data!.items.length === 0 ? <p className="rounded-2xl border p-6 text-center text-muted-foreground" data-testid="no-tasks"><ShieldCheck className="mx-auto mb-2 h-6 w-6" aria-hidden="true" />{t("onb.noTasks")}</p> : (
            <ul className="space-y-3" data-testid="task-list">{tasks.data!.items.map((tk) => <TaskCard key={tk.id} task={tk} batchId={id} locked={locked} />)}</ul>
          )}
          {tasks.data && tasks.data.total > tasks.data.pageSize && <div className="mt-3 flex items-center gap-2"><Button size="sm" variant="outline" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>{t("onb.prev")}</Button><span className="text-sm">{f.page} / {Math.ceil(tasks.data.total / tasks.data.pageSize)}</span><Button size="sm" variant="outline" disabled={f.page * tasks.data.pageSize >= tasks.data.total} onClick={() => setF({ ...f, page: f.page + 1 })}>{t("onb.next")}</Button></div>}
        </TabsContent>
        <TabsContent value="files"><ul className="divide-y rounded-2xl border bg-card">{(bt.files ?? []).map((x) => <li key={x.id} className="flex items-center justify-between gap-3 p-3 text-sm"><span className="min-w-0 truncate" dir="auto">{x.name}</span><span className="flex items-center gap-2"><Badge variant={x.kind === "REJECTED" ? "destructive" : "outline"}>{x.kind === "REJECTED" ? t(`onb.reject.${x.rejectReason}`, { defaultValue: x.rejectReason }) : t(`onb.kind.${x.kind}`)}</Badge><span className="text-xs text-muted-foreground" dir="ltr">{Math.ceil(x.size / 1024)} KB</span></span></li>)}</ul></TabsContent>
        <TabsContent value="mapping" data-testid="mapping">
          {(bt.summary?.classification ?? []).map((c) => (
            <div key={c.table} className="mb-3 rounded-2xl border bg-card p-3 text-sm"><b dir="ltr">{c.table}</b> → {c.entity ? <Badge variant="info">{t(`onb.entity.${c.entity}`)}</Badge> : <Badge variant="warning">{t("onb.unclassified")}</Badge>} <span className="text-muted-foreground">({c.rows} {t("onb.rows")})</span>
              {c.entity && <div className="mt-2 flex flex-wrap gap-1.5">{(bt.summary?.mappings[c.entity] ?? []).map((m) => <span key={m.field} className="rounded-md border px-1.5 py-0.5 text-xs" dir="ltr">{m.field} ← {m.column ?? "—"}{m.column && m.confidence < 0.85 ? " ?" : ""}</span>)}</div>}
            </div>
          ))}
        </TabsContent>
        <TabsContent value="commit">
          {dry.data && "willCreate" in dry.data ? (
            <div className="space-y-3" data-testid="dry-run">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Object.entries(dry.data.willCreate).map(([k, v]) => <StatCard key={k} label={t(`onb.entity.${k}`)} value={v} />)}</div>
              <p className="text-sm text-muted-foreground">{t("onb.dryNote", { files: dry.data.filesToAttach, merged: dry.data.mergedPatients, warn: dry.data.openWarnings, ignored: dry.data.ignoredWithReason })}</p>
              {!dry.data.canCommit && <p className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t("onb.cannotCommit", { n: dry.data.openBlockers })}</p>}
              <p className="text-xs text-muted-foreground">{t("onb.targetMode", { mode: dry.data.targetMode })}</p>
            </div>
          ) : bt.progress ? <pre className="rounded-xl border p-3 text-xs" dir="ltr">{JSON.stringify(bt.progress)}</pre> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {["READY", "AWAITING_APPROVAL"].includes(st) && <Button disabled={!dry.data?.canCommit || act.isPending} onClick={() => call("request-commit", {}, t("onb.requested"))} data-testid="act-request">{t("onb.requestCommit")}</Button>}
            {st === "AWAITING_APPROVAL" && isSuper && <>
              <Button disabled={act.isPending || me === bt.requestedBy || me === bt.createdBy} onClick={() => call("approve", { reportHash: dry.data && "reportHash" in dry.data ? dry.data.reportHash : "" }, t("onb.approved"))} data-testid="act-approve"><ShieldCheck aria-hidden="true" />{t("onb.approve")}</Button>
              {(me === bt.requestedBy || me === bt.createdBy) && <span className="text-xs text-muted-foreground" data-testid="two-person-note">{t("onb.twoPerson")}</span>}
            </>}
            {["APPROVED", "COMMIT_FAILED"].includes(st) && isSuper && <Button disabled={act.isPending} onClick={() => call("commit", {}, t("onb.committed"))} data-testid="act-commit">{st === "COMMIT_FAILED" ? t("onb.resume") : t("onb.commit")}</Button>}
            {["COMMITTED", "COMMIT_FAILED"].includes(st) && isSuper && <div className="flex gap-2"><Input aria-label={t("onb.rollbackReason")} placeholder={t("onb.rollbackReason")} className="w-60" dir="auto" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rollback-reason" /><Button variant="outline" disabled={reason.trim().length < 3 || act.isPending} onClick={() => call("rollback", { reason }, t("onb.rolledBack"))} data-testid="act-rollback"><Undo2 aria-hidden="true" />{t("onb.rollback")}</Button></div>}
            {["COMMITTED", "ROLLED_BACK"].includes(st) && isSuper && <Button variant="ghost" onClick={() => call("purge-staging", {}, t("onb.purged"))}>{t("onb.purge")}</Button>}
          </div>
          {st === "COMMITTED" && <p className="mt-3 text-sm text-success" data-testid="commit-done">{t("onb.commitDone", { n: Object.values(bt.progress ?? {}).filter((v) => typeof v === "number").reduce((a: number, v) => a + (v as number), 0) })}</p>}
        </TabsContent>
        <TabsContent value="audit"><ul className="divide-y rounded-2xl border bg-card text-sm">{(audit.data ?? []).map((a) => <li key={a.id} className="flex flex-wrap justify-between gap-2 p-3"><code dir="ltr">{a.action.replace("onboarding.", "")}</code><span className="text-xs text-muted-foreground" dir="ltr">{a.actor} · {formatDateTime(a.createdAt, i18n.language)}</span></li>)}</ul></TabsContent>
      </Tabs>
    </div>
  );
}
