import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, KeyRound, Lock, ToggleRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useGateBoard, useRecordGateAll } from "@/api/home";
import { downloadAuditCsv, useDecideRequest, useFlagAudit, useFlagRequests, useFlags, usePropagation, useRecordGate, useRevokeGate, useSetFlag, type FlagRow } from "@/api/hooks";
import { ApiError } from "@/api/errors";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/auth/AuthProvider";
import { isSuperAdmin } from "@/auth/RequireOps";
import { formatAge, formatDateTime, localToIso } from "@/lib/format";

const PRODUCTS = ["kiorex", "kiorly-clinic", "kiorex-account", "kiorly-pharmacy", "kiorly-lab", "all"];
const CLASSES = ["MODULE", "COMMERCIAL", "INTEGRATION", "AI", "LAUNCH_LOCKED"];
const sel = "h-11 rounded-xl border border-input bg-card px-3 text-sm";

export function StateBadge({ state }: { state: FlagRow["state"] }) {
  const { t } = useTranslation();
  return <Badge variant={state === "ON" ? "success" : state === "OFF" ? "destructive" : "warning"} data-testid="flag-state">{state === "ON_AWAITING_GATE" ? t("flags.onAwaitingGate") : state}</Badge>;
}

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? `${e.code}: ${e.message}` : fallback);

function ToggleDialog({ flag, market, onClose }: { flag: FlagRow | null; market: string; onClose: () => void }) {
  const { t } = useTranslation();
  const set = useSetFlag();
  const [scope, setScope] = useState("GLOBAL");
  const [scopeId, setScopeId] = useState(market);
  const [value, setValue] = useState<"ON" | "OFF">("OFF");
  const [reason, setReason] = useState(""); const [ticket, setTicket] = useState("");
  const [expires, setExpires] = useState(""); const [starts, setStarts] = useState(""); const [emergency, setEmergency] = useState(false);
  if (!flag) return null;
  const twoPerson = value === "OFF" && flag.moneyPath && scope !== "ORG";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    set.mutate({ key: flag.key, body: { scope: scope as "GLOBAL", ...(scope !== "GLOBAL" ? { scopeId } : {}), value, reason: reason.trim(), ticket: ticket.trim(), expiresAt: localToIso(expires), startsAt: localToIso(starts), ...(twoPerson && emergency ? { emergency: true } : {}) } }, {
      onSuccess: (r) => { toast.success(r.status === "PENDING_APPROVAL" ? t("flags.pendingApproval") : t("flags.applied")); onClose(); },
      onError: (er) => toast.error(errMsg(er, t("states.errorTitle"))),
    });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="toggle-dialog">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader><DialogTitle>{t("flags.toggleTitle")} <code className="text-sm">{flag.key}</code></DialogTitle><DialogDescription>{flag.whenOff}</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="tg-value">{t("flags.value")}</Label><select id="tg-value" className={`${sel} w-full`} value={value} onChange={(e) => setValue(e.target.value as "ON" | "OFF")}><option value="OFF">OFF</option><option value="ON">ON ({t("flags.clearOverride")})</option></select></div>
            <div className="space-y-1"><Label htmlFor="tg-scope">{t("flags.scope")}</Label><select id="tg-scope" className={`${sel} w-full`} value={scope} onChange={(e) => setScope(e.target.value)}>{flag.scopes.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          {scope !== "GLOBAL" && <div className="space-y-1"><Label htmlFor="tg-sid">{scope === "MARKET" ? t("flags.marketCode") : t("flags.orgId")}</Label><Input id="tg-sid" value={scopeId} onChange={(e) => setScopeId(e.target.value)} required dir="ltr" /></div>}
          <div className="space-y-1"><Label htmlFor="tg-reason">{t("flags.reason")} *</Label><Input id="tg-reason" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} /></div>
          <div className="space-y-1"><Label htmlFor="tg-ticket">{t("flags.ticket")} *</Label><Input id="tg-ticket" value={ticket} onChange={(e) => setTicket(e.target.value)} required dir="ltr" placeholder="OPS-123" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="tg-exp">{t("flags.expiry")}</Label><Input id="tg-exp" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="tg-start">{t("flags.schedule")}</Label><Input id="tg-start" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
          </div>
          {twoPerson && (
            <div className="space-y-2 rounded-xl border border-warning/50 bg-warning-soft p-3 text-sm" role="note" data-testid="two-person-note">
              <p>{t("flags.twoPersonNote")}</p>
              <label className="flex min-h-11 items-center gap-3"><Checkbox checked={emergency} onCheckedChange={(c) => setEmergency(c === true)} data-testid="emergency" /><span>{t("flags.emergency")}</span></label>
            </div>
          )}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" disabled={set.isPending || !reason.trim() || !ticket.trim()} data-testid="toggle-submit">{twoPerson && !emergency ? t("flags.requestApproval") : t("flags.apply")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GateDialog({ flag, onClose }: { flag: FlagRow | null; onClose: () => void }) {
  const { t } = useTranslation();
  const rec = useRecordGate(); const rev = useRevokeGate();
  const [f, setF] = useState({ gateId: "", approver: "", approvedOn: "", documentUrl: "" });
  if (!flag) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    rec.mutate({ key: flag.key, body: { gateId: f.gateId.trim(), approver: f.approver.trim(), approvedOn: new Date(f.approvedOn).toISOString(), documentUrl: f.documentUrl.trim() } }, {
      onSuccess: () => { toast.success(t("flags.gateRecorded")); onClose(); }, onError: (er) => toast.error(errMsg(er, t("states.errorTitle"))),
    });
  };
  const ok = f.gateId.trim() && f.approver.trim() && f.approvedOn && /^https?:\/\//i.test(f.documentUrl);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="gate-dialog">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader><DialogTitle>{t("flags.gateTitle")} <code className="text-sm">{flag.key}</code></DialogTitle><DialogDescription>{t("flags.gateHint")}{flag.gateHint ? ` — ${flag.gateHint}` : ""}</DialogDescription></DialogHeader>
          {flag.gate && <p className="rounded-lg bg-success-soft p-3 text-sm text-success">{t("flags.gateCurrent", { id: flag.gate.gateId, approver: flag.gate.approver })}</p>}
          <div className="space-y-1"><Label htmlFor="g-id">{t("flags.gateId")} *</Label><Input id="g-id" value={f.gateId} onChange={(e) => setF({ ...f, gateId: e.target.value })} required dir="ltr" /></div>
          <div className="space-y-1"><Label htmlFor="g-ap">{t("flags.approver")} *</Label><Input id="g-ap" value={f.approver} onChange={(e) => setF({ ...f, approver: e.target.value })} required /></div>
          <div className="space-y-1"><Label htmlFor="g-on">{t("flags.approvedOn")} *</Label><Input id="g-on" type="date" value={f.approvedOn} onChange={(e) => setF({ ...f, approvedOn: e.target.value })} required /></div>
          <div className="space-y-1"><Label htmlFor="g-doc">{t("flags.documentUrl")} *</Label><Input id="g-doc" type="url" value={f.documentUrl} onChange={(e) => setF({ ...f, documentUrl: e.target.value })} required dir="ltr" placeholder="https://" /></div>
          <DialogFooter>
            {flag.gate && <Button type="button" variant="outline" onClick={() => rev.mutate({ key: flag.key, reason: "revoked from console" }, { onSuccess: onClose })}>{t("flags.gateRevoke")}</Button>}
            <Button type="submit" disabled={!ok || rec.isPending} data-testid="gate-submit">{t("flags.gateRecord")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FlagsTab({ canAct }: { canAct: boolean }) {
  const { t, i18n } = useTranslation();
  const [market, setMarket] = useState("EG"); const [product, setProduct] = useState(""); const [cls, setCls] = useState(""); const [state, setState] = useState(""); const [q, setQ] = useState("");
  const flags = useFlags(market, product);
  const [toggle, setToggle] = useState<FlagRow | null>(null); const [gate, setGate] = useState<FlagRow | null>(null);
  const rows = useMemo(() => (flags.data ?? []).filter((f) => (!cls || f.class === cls) && (!state || f.state === state) && (!q || f.key.includes(q.toLowerCase()))), [flags.data, cls, state, q]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="f-q">{t("common.search")}</Label><Input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" placeholder="kiorex.marketplace" dir="ltr" /></div>
        <div className="space-y-1"><Label htmlFor="f-p">{t("flags.product")}</Label><select id="f-p" className={sel} value={product} onChange={(e) => setProduct(e.target.value)}><option value="">{t("common.all")}</option>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="f-c">{t("flags.class")}</Label><select id="f-c" className={sel} value={cls} onChange={(e) => setCls(e.target.value)}><option value="">{t("common.all")}</option>{CLASSES.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="f-s">{t("flags.state")}</Label><select id="f-s" className={sel} value={state} onChange={(e) => setState(e.target.value)}><option value="">{t("common.all")}</option><option>ON</option><option>OFF</option><option value="ON_AWAITING_GATE">{t("flags.onAwaitingGate")}</option></select></div>
        <div className="space-y-1"><Label htmlFor="f-m">{t("flags.market")}</Label><Input id="f-m" value={market} onChange={(e) => setMarket(e.target.value.toUpperCase().slice(0, 2))} className="w-20" dir="ltr" maxLength={2} /></div>
      </div>
      {flags.isLoading ? <CardSkeleton rows={2} /> : flags.error ? <ErrorState error={flags.error} onRetry={() => void flags.refetch()} /> : (
        <DataTable caption={t("flags.title")} rows={rows} rowKey={(f) => f.key} empty={t("common.empty")} columns={[
          { key: "k", header: t("flags.key"), cell: (f) => <div><code className="text-xs font-semibold" dir="ltr">{f.key}</code><div className="mt-1 flex gap-1"><Badge variant="secondary">{f.product}</Badge>{f.moneyPath && <Badge variant="warning">{t("flags.money")}</Badge>}</div></div> },
          { key: "c", header: t("flags.class"), cell: (f) => <div className="space-y-1">{f.launchLocked ? <Badge variant="pulse"><Lock className="me-1 h-3 w-3" aria-hidden="true" />{f.class}</Badge> : f.class}
            {f.gateIds.length > 0 && <div className="flex flex-wrap gap-1" data-testid="flag-gates">{f.gateIds.map((g) => <Badge key={g} variant={f.missingGates.includes(g) ? "warning" : "success"} data-testid={`flag-gate-${g}`}>{g}{f.missingGates.includes(g) ? ` · ${t("flags.gateMissing")}` : ""}</Badge>)}</div>}</div> },
          { key: "g", header: t("flags.effectiveGlobal"), cell: (f) => <Badge variant={f.effective.global ? "success" : "destructive"}>{f.effective.global ? "ON" : "OFF"}</Badge> },
          { key: "m", header: t("flags.effectiveMarket", { market }), cell: (f) => <div className="space-y-1"><StateBadge state={f.state} />{f.overrides.length > 0 && <p className="text-xs text-muted-foreground">{f.overrides.map((o) => `${o.scope}${o.scopeId ? `:${o.scopeId}` : ""}`).join(", ")}</p>}</div> },
          { key: "s", header: t("flags.source"), cell: (f) => <div className="text-xs"><b>{f.source?.scope}</b>{f.source?.ticket ? ` · ${f.source?.ticket}` : ""}{f.source?.expiresAt ? <p className="text-warning">{t("flags.expires", { at: formatDateTime(f.source?.expiresAt, i18n.language) })}</p> : null}</div> },
          { key: "d", header: t("flags.dependsOn"), cell: (f) => f.dependsOn.length ? <span className="text-xs" dir="ltr">{f.dependsOn.join(", ")}</span> : "—" },
          { key: "l", header: t("flags.lastChange"), cell: (f) => f.lastChange ? <div className="text-xs">{formatDateTime(f.lastChange.at, i18n.language)}<br />{f.lastChange.actor} · {f.lastChange.event}</div> : "—" },
          { key: "a", header: "", cell: (f) => (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!canAct} onClick={() => setToggle(f)} data-testid={`toggle-${f.key}`}><ToggleRight aria-hidden="true" />{t("flags.toggle")}</Button>
              {f.launchLocked && <Button size="sm" variant="outline" disabled={!canAct} onClick={() => setGate(f)} data-testid={`gate-${f.key}`}><KeyRound aria-hidden="true" />{t("flags.gate")}</Button>}
            </div>) },
        ]} />
      )}
      {!canAct && <p className="text-sm text-muted-foreground">{t("flags.readOnly")}</p>}
      <ToggleDialog key={toggle?.key} flag={toggle} market={market} onClose={() => setToggle(null)} />
      <GateDialog key={gate?.key ?? "g"} flag={gate} onClose={() => setGate(null)} />
    </div>
  );
}

function ApprovalsTab({ canAct }: { canAct: boolean }) {
  const { t, i18n } = useTranslation();
  const r = useFlagRequests(); const decide = useDecideRequest();
  const act = (id: string, action: "approve" | "reject" | "review") => decide.mutate({ id, action }, { onSuccess: () => toast.success(t("flags.done")), onError: (e) => toast.error(errMsg(e, t("states.errorTitle"))) });
  if (r.isLoading) return <CardSkeleton rows={1} />;
  if (r.error) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  return (
    <DataTable caption={t("flags.approvals")} rows={r.data!} rowKey={(x) => x.id} empty={t("flags.noRequests")} columns={[
      { key: "k", header: t("flags.key"), cell: (x) => <code className="text-xs" dir="ltr">{x.flagKey}</code> }, { key: "s", header: t("flags.scope"), cell: (x) => `${x.scope}${x.scopeId ? `:${x.scopeId}` : ""} → ${x.value}` },
      { key: "r", header: t("flags.reason"), cell: (x) => <div className="max-w-xs text-xs">{x.reason}<br /><span className="text-muted-foreground">{x.ticket}</span></div> },
      { key: "b", header: t("flags.requestedBy"), cell: (x) => <div className="text-xs">{x.requestedBy}<br />{formatDateTime(x.createdAt, i18n.language)}</div> },
      { key: "t", header: t("flags.state"), cell: (x) => <div className="space-y-1"><Badge variant={x.status === "PENDING" ? "warning" : x.status === "APPROVED" ? "success" : "secondary"}>{x.status}</Badge>{x.emergency && <Badge variant="destructive" className="ms-1">{t("flags.emergencyBadge")}</Badge>}{x.emergency && !x.reviewedAt && x.reviewDueAt && <p className="text-xs text-warning">{t("flags.reviewDue", { at: formatDateTime(x.reviewDueAt, i18n.language) })}</p>}</div> },
      { key: "a", header: "", cell: (x) => (
        <div className="flex gap-2">
          {x.status === "PENDING" && <><Button size="sm" disabled={!canAct || decide.isPending} onClick={() => act(x.id, "approve")} data-testid={`approve-${x.id}`}>{t("flags.approve")}</Button><Button size="sm" variant="outline" disabled={!canAct} onClick={() => act(x.id, "reject")}>{t("flags.reject")}</Button></>}
          {x.emergency && !x.reviewedAt && <Button size="sm" variant="outline" disabled={!canAct} onClick={() => act(x.id, "review")}>{t("flags.markReviewed")}</Button>}
        </div>) },
    ]} />
  );
}

function AuditTab() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [key, setKey] = useState("");
  const r = useFlagAudit(key);
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="space-y-1"><Label htmlFor="a-k">{t("flags.key")}</Label><Input id="a-k" value={key} onChange={(e) => setKey(e.target.value)} className="w-64" dir="ltr" /></div>
        <Button variant="outline" onClick={() => void downloadAuditCsv(user?.token ?? null, key || undefined).catch(() => toast.error(t("states.errorTitle")))} data-testid="export-audit"><Download aria-hidden="true" />{t("flags.exportCsv")}</Button>
      </div>
      {r.isLoading ? <CardSkeleton rows={1} /> : r.error ? <ErrorState error={r.error} onRetry={() => void r.refetch()} /> : (
        <DataTable caption={t("flags.audit")} rows={r.data!} rowKey={(a) => a.id ?? `${a.createdAt}-${a.flagKey}-${a.event}`} empty={t("flags.noAudit")} columns={[
          { key: "t", header: t("flags.at"), cell: (a) => formatDateTime(a.createdAt, i18n.language) }, { key: "k", header: t("flags.key"), cell: (a) => <code className="text-xs" dir="ltr">{a.flagKey}</code> },
          { key: "e", header: t("flags.event"), cell: (a) => a.event ?? "—" }, { key: "s", header: t("flags.scope"), cell: (a) => `${a.scope ?? ""}${a.scopeId ? `:${a.scopeId}` : ""}` },
          { key: "v", header: t("flags.change"), cell: (a) => `${a.oldValue ?? "—"} → ${a.newValue ?? "—"}` }, { key: "a", header: t("flags.actor"), cell: (a) => a.actor },
          { key: "r", header: t("flags.reason"), cell: (a) => <span className="text-xs">{a.reason ?? ""} {a.ticket ? `(${a.ticket})` : ""}</span> },
        ]} />
      )}
    </div>
  );
}

function PropagationTab() {
  const { t, i18n } = useTranslation();
  const r = usePropagation();
  if (r.isLoading) return <CardSkeleton rows={1} />;
  if (r.error) return <ErrorState error={r.error} onRetry={() => void r.refetch()} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("flags.currentVersion")}: <b className="kx-label-num">{r.data!.currentVersion}</b></p>
      <DataTable caption={t("flags.propagation")} rows={r.data!.products} rowKey={(p) => p.product} empty={t("common.empty")} columns={[
        { key: "p", header: t("flags.product"), cell: (p) => <b>{p.product}</b> }, { key: "v", header: t("flags.snapshotVersion"), cell: (p) => p.snapshotVersion },
        { key: "b", header: t("flags.behind"), cell: (p) => p.versionsBehind }, { key: "a", header: t("flags.age"), cell: (p) => formatAge(p.ageSeconds) },
        { key: "s", header: t("flags.state"), cell: (p) => <Badge variant={p.status === "IN_SYNC" ? "success" : p.status === "STALE" ? "destructive" : "warning"} data-testid="prop-status">{p.status}</Badge> },
        { key: "u", header: t("flags.lastPush"), cell: (p) => { const lp = p.lastPush as { at?: string | null; error?: string | null }; return <span className="text-xs">{formatDateTime(lp.at ?? null, i18n.language)}{lp.error ? ` · ${lp.error}` : ""}{p.webhookConfigured ? "" : ` · ${t("flags.noWebhook")}`}</span>; } },
      ]} />
    </div>
  );
}

function GatesTab({ canAct }: { canAct: boolean }) {
  const { t, i18n } = useTranslation();
  const board = useGateBoard();
  const rec = useRecordGateAll();
  const [gate, setGate] = useState<string | null>(null);
  const [f, setF] = useState({ approver: "", approvedOn: "", documentUrl: "" });
  if (board.isLoading) return <CardSkeleton rows={1} />;
  if (board.error) return <ErrorState error={board.error} onRetry={() => void board.refetch()} />;
  const ok = f.approver.trim() && f.approvedOn && /^https?:\/\//i.test(f.documentUrl);
  return (
    <div className="space-y-3" data-testid="gate-board">
      <p className="text-sm text-muted-foreground">{t("flags.gatesHint")}</p>
      <DataTable caption={t("flags.tabs.gates")} rows={board.data!.gates} rowKey={(g) => g.gateId} empty={t("common.empty")} columns={[
        { key: "g", header: t("flags.gateId"), cell: (g) => <b data-testid={`board-${g.gateId}`}>{g.gateId}</b> },
        { key: "f", header: t("flags.unlocks"), cell: (g) => <ul className="space-y-1 text-xs">{g.flags.map((x) => <li key={x.key} className="flex items-center gap-2"><code dir="ltr">{x.key}</code>{x.evidence ? <Badge variant="success">{t("flags.gateEvidence")}</Badge> : <Badge variant="warning">{t("flags.gateMissing")}</Badge>}</li>)}</ul> },
        { key: "e", header: t("flags.evidence"), cell: (g) => { const e = g.flags.find((x) => x.evidence)?.evidence as { approver?: string; approvedOn?: string } | null | undefined; return e ? <span className="text-xs">{e.approver} · {formatDateTime(e.approvedOn ?? null, i18n.language)}</span> : "—"; } },
        { key: "a", header: "", cell: (g) => <Button size="sm" variant="outline" disabled={!canAct} onClick={() => setGate(g.gateId)} data-testid={`record-${g.gateId}`}><KeyRound aria-hidden="true" />{t("flags.gateRecord")}</Button> },
      ]} />
      {gate && (
        <Dialog open onOpenChange={(o) => !o && setGate(null)}>
          <DialogContent data-testid="gate-all-dialog">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); rec.mutate({ gateId: gate, body: { approver: f.approver.trim(), approvedOn: new Date(f.approvedOn).toISOString(), documentUrl: f.documentUrl.trim() } }, { onSuccess: () => { toast.success(t("flags.gateRecorded")); setGate(null); }, onError: (er) => toast.error(errMsg(er, t("states.errorTitle"))) }); }}>
              <DialogHeader><DialogTitle>{t("flags.gateTitle")} <code className="text-sm">{gate}</code></DialogTitle><DialogDescription>{t("flags.gateHint")}</DialogDescription></DialogHeader>
              <div className="space-y-1"><Label htmlFor="ga-ap">{t("flags.approver")} *</Label><Input id="ga-ap" value={f.approver} onChange={(e) => setF({ ...f, approver: e.target.value })} required /></div>
              <div className="space-y-1"><Label htmlFor="ga-on">{t("flags.approvedOn")} *</Label><Input id="ga-on" type="date" value={f.approvedOn} onChange={(e) => setF({ ...f, approvedOn: e.target.value })} required /></div>
              <div className="space-y-1"><Label htmlFor="ga-doc">{t("flags.documentUrl")} *</Label><Input id="ga-doc" type="url" dir="ltr" value={f.documentUrl} onChange={(e) => setF({ ...f, documentUrl: e.target.value })} required placeholder="https://" /></div>
              <DialogFooter><Button type="button" variant="outline" onClick={() => setGate(null)}>{t("common.cancel")}</Button><Button type="submit" disabled={!ok || rec.isPending} data-testid="gate-all-submit">{t("flags.gateRecord")}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default function FlagsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canAct = !!user && isSuperAdmin(user.roles);
  return (
    <div>
      <PageHeader title={t("flags.title")} hint={t("flags.hint")} />
      <Tabs defaultValue="flags">
        <TabsList className="mb-4 h-auto flex-wrap justify-start">
          {(["flags", "gates", "approvals", "audit", "propagation"] as const).map((k) => <TabsTrigger key={k} value={k} className="min-h-11 px-5" data-testid={`tab-${k}`}>{t(`flags.tabs.${k}`)}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="flags"><FlagsTab canAct={canAct} /></TabsContent>
        <TabsContent value="gates"><GatesTab canAct={canAct} /></TabsContent>
        <TabsContent value="approvals"><ApprovalsTab canAct={canAct} /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
        <TabsContent value="propagation"><PropagationTab /></TabsContent>
      </Tabs>
    </div>
  );
}
