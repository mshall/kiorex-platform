import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Eye, FlaskConical, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useIcCheck, useIcProposeMode, useIcTestSend, useIntegrationsCenter, type IcRow } from "@/api/integrationsCenter";
import { PageHeader, StatTile } from "@/components/PageHeader";
import { StatusChip, type Tone } from "@/components/kit";
import { CardSkeleton, ErrorState } from "@/components/states";
import { formatDateTime } from "@/lib/format";

const GROUPS = ["payments", "messaging", "push", "marketing", "ai", "platform"] as const;
const field = "min-h-11 w-full rounded-xl border border-input bg-card px-3 text-sm";
const driftTone: Record<IcRow["drift"], Tone> = { NONE: "success", APPROVED_NOT_DEPLOYED: "warning", REAL_NOT_APPROVED: "danger" };

/** Integrations Control Center: one card per external integration. Only variable NAMES and yes/no appear; a mode change is a maker-checker proposal, never an edit. */
export default function IntegrationsCenterPage() {
  const { t, i18n } = useTranslation();
  const q = useIntegrationsCenter();
  const d = q.data; const manage = !!d?.canManage; const ar = i18n.language.startsWith("ar");
  return (
    <div>
      <PageHeader title={t("ic.title")} hint={t("ic.hint")} actions={<Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching} data-testid="ic-refresh"><RefreshCw className="h-4 w-4" aria-hidden="true" />{t("ic.refresh")}</Button>} />
      {q.isLoading ? <CardSkeleton rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : d && (
        <>
          {!manage && <p role="note" className="mb-4 flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted px-4 py-2 text-sm" data-testid="ic-readonly"><Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t("ic.readOnly")}</p>}
          <p role="note" className="mb-4 flex items-start gap-2 rounded-xl border bg-card px-4 py-2 text-sm" data-testid="ic-rules"><FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{t("ic.rules")}</p>
          {d.counsel && (
            <p role="status" className="mb-4 rounded-xl border bg-card px-4 py-2 text-sm" data-testid="ic-counsel">
              <b>{t("ic.counsel.title", { market: d.counsel.market })}</b>: {t(`commissions.policyPage.counselStatus.${d.counsel.status}`)} · {d.counsel.realBlocked > 0 ? t("ic.counsel.blocked", { count: d.counsel.realBlocked }) : t("ic.counsel.open")} <Link to="/commission-policy" className="font-semibold underline">{t("ic.counsel.link")}</Link>
            </p>
          )}
          {d.pendingProposal && (
            <p role="status" className="mb-4 rounded-xl border border-warning/60 bg-warning-soft px-4 py-2 text-sm text-warning" data-testid="ic-pending">
              <b>{t("ic.pending")}</b>: {Object.entries(d.pendingProposal.modes).map(([k, v]) => `${k} → ${v}`).join(", ")} <Link to="/growth/config" className="font-semibold underline">{t("ic.pendingOpen")}</Link>
            </p>
          )}
          <div className="mb-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="ic-tiles">
            <StatTile label={t("ic.tiles.total")} value={d.summary.total} />
            <StatTile label={t("ic.tiles.real")} value={d.summary.real} />
            <StatTile label={t("ic.tiles.mock")} value={d.summary.mock} />
            <StatTile label={t("ic.tiles.drift")} value={d.summary.drift} tone={d.summary.drift ? "warn" : "ok"} />
            <StatTile label={t("ic.tiles.notReady")} value={d.summary.notReady} tone={d.summary.notReady ? "warn" : "ok"} />
            <StatTile label={t("ic.tiles.unobservable")} value={d.summary.unobservable} />
          </div>
          {GROUPS.map((g) => {
            const rows = d.integrations.filter((r) => r.group === g); if (!rows.length) return null;
            return (
              <section key={g} aria-labelledby={`ic-g-${g}`} className="mb-8" data-testid={`ic-group-${g}`}>
                <h2 id={`ic-g-${g}`} className="mb-3 text-lg font-semibold">{t(`ic.groups.${g}`)}</h2>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map((r) => <IntegrationCard key={r.key} r={r} manage={manage} ar={ar} lang={i18n.language} />)}</div>
              </section>
            );
          })}
          <p className="text-xs text-muted-foreground" data-testid="ic-generated">{t("ic.generated")}: {formatDateTime(d.generatedAt, i18n.language)}. {t("ic.synthetic")}</p>
        </>
      )}
    </div>
  );
}

const apiErr = (t: (k: string) => string) => (e: unknown) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle"));

function IntegrationCard({ r, manage, ar, lang }: { r: IcRow; manage: boolean; ar: boolean; lang: string }) {
  const { t } = useTranslation();
  const check = useIcCheck(); const send = useIcTestSend(); const propose = useIcProposeMode();
  const [panel, setPanel] = useState<"" | "send" | "propose">("");
  const [to, setTo] = useState(""); const [mode, setMode] = useState<"mock" | "real">(r.approvedMode === "real" ? "mock" : "real"); const [reason, setReason] = useState("");
  const err = apiErr(t);
  const name = ar ? r.label.ar : r.label.en;
  const modeTone: Tone = r.mode === "real" ? "warning" : r.mode === "mock" ? "info" : "neutral";
  return (
    <article className="kx-card flex flex-col gap-3 p-4" aria-labelledby={`ic-n-${r.key}`} data-testid={`ic-card-${r.key}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`ic-n-${r.key}`} className="text-base font-semibold">{name}</h3>
        <StatusChip tone={modeTone} data-testid={`ic-mode-${r.key}`}>{r.mode === null ? t("ic.mode.unknown") : t(`ic.mode.${r.mode}`)}</StatusChip>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t("ic.approved")}</dt><dd>{t(`ic.mode.${r.approvedMode}`)} <StatusChip tone={driftTone[r.drift]} className="ms-1" data-testid={`ic-drift-${r.key}`}>{t(`ic.drift.${r.drift}`)}</StatusChip></dd>
        <dt className="text-muted-foreground">{t("ic.secrets.label")}</dt><dd><StatusChip tone={r.secretRefSet ? "success" : "neutral"} data-testid={`ic-secret-${r.key}`}>{r.secretRefSet ? t("ic.secrets.set") : t("ic.secrets.unset")}</StatusChip></dd>
        <dt className="text-muted-foreground">{t("ic.ready.label")}</dt><dd>{r.mode === "real" ? <StatusChip tone={r.ready ? "success" : "danger"} data-testid={`ic-ready-${r.key}`}>{r.ready ? t("ic.ready.yes") : t("ic.ready.no")}</StatusChip> : <span className="text-muted-foreground">{t("ic.ready.na")}</span>}</dd>
        <dt className="text-muted-foreground">{t("ic.circuit")}</dt><dd data-testid={`ic-circuit-${r.key}`}>{r.circuit ? <StatusChip tone={r.circuit.state === "OPEN" ? "danger" : r.circuit.state === "HALF_OPEN" ? "warning" : "success"}>{r.circuit.state}</StatusChip> : <span className="text-muted-foreground">{t("ic.circuitNone")}</span>}</dd>
        <dt className="text-muted-foreground">{t("ic.lastCheck")}</dt>
        <dd data-testid={`ic-lastcheck-${r.key}`}>{r.lastCheck ? <><StatusChip tone={r.lastCheck.ok ? "success" : "danger"}>{r.lastCheck.ok ? t("ic.ok") : t("ic.failed")}</StatusChip> <span className="text-xs text-muted-foreground">{formatDateTime(r.lastCheck.at, lang)}</span></> : <span className="text-muted-foreground">{t("ic.never")}</span>}</dd>
        {r.lastRun && <><dt className="text-muted-foreground">{t("ic.lastRun")}</dt><dd className="text-xs">{r.lastRun.status} · {formatDateTime(r.lastRun.startedAt, lang)}</dd></>}
      </dl>
      {!r.observable && <p className="text-xs text-muted-foreground">{t("ic.notObservable")} ({t(`ic.owner.${r.owner}`)})</p>}
      {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
      {r.problems.length > 0 && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs"><b>{t("ic.problems")}</b><ul className="mt-1 list-disc ps-4">{r.problems.map((p) => <li key={p} dir="ltr" className="text-start">{p}</li>)}</ul></div>}
      {r.webhook && (
        <div className="text-xs" data-testid={`ic-webhook-${r.key}`}>
          <p className="font-semibold">{t("ic.webhook")}</p>
          <code dir="ltr" className="block break-all text-start">{r.webhook.url ?? r.webhook.path}</code>
          {r.webhook.verifyTokenEnv && <p className="mt-1">{t("ic.verifyToken")}: <code dir="ltr">{r.webhook.verifyTokenEnv}</code> · {r.webhook.verifyTokenSet ? t("ic.isSet") : t("ic.isUnset")}</p>}
          {r.webhook.secretEnv && <p>{t("ic.webhookSecret")}: <code dir="ltr">{r.webhook.secretEnv}</code> · {r.webhook.secretSet ? t("ic.isSet") : t("ic.isUnset")}</p>}
        </div>
      )}
      {r.env.length > 0 && (
        <details className="text-xs">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{t("ic.env")} ({r.env.filter((e) => e.set).length}/{r.env.length})</summary>
          <p className="mb-1 text-muted-foreground">{t("ic.envHint")}</p>
          <ul className="space-y-1">{r.env.map((e) => <li key={e.name} className="flex flex-wrap items-center gap-2"><code dir="ltr">{e.name}</code><span className="text-muted-foreground">{e.required ? t("ic.required") : t("ic.optional")}</span><StatusChip tone={e.set ? "success" : e.required ? "warning" : "neutral"}>{e.set ? t("ic.isSet") : t("ic.isUnset")}</StatusChip></li>)}</ul>
        </details>
      )}
      <p className="text-xs"><span className="font-semibold">{t("ic.runbook")}:</span> <code dir="ltr" className="break-all" data-testid={`ic-runbook-${r.key}`}>{r.runbook}</code></p>
      {r.needsHuman.length > 0 && <p className="flex flex-wrap items-center gap-1 text-xs"><span className="font-semibold">{t("ic.needsHuman")}:</span>{r.needsHuman.map((n) => <StatusChip key={n} tone="warning" dot={false}>{n}</StatusChip>)}</p>}
      {manage && (
        <div className="mt-auto flex flex-wrap gap-2">
          <Button variant="outline" disabled={check.isPending} data-testid={`ic-check-${r.key}`} onClick={() => check.mutate(r.key, { onSuccess: (x) => (x.ok ? toast.success(`${t("ic.checked")}: ${x.detail}`) : toast.error(`${t("ic.checked")}: ${x.detail}`)), onError: err })}>{check.isPending ? t("ic.actions.checking") : t("ic.actions.check")}</Button>
          {r.testSend && r.mode !== "real" && <Button variant="outline" data-testid={`ic-testsend-${r.key}`} aria-expanded={panel === "send"} onClick={() => setPanel(panel === "send" ? "" : "send")}>{t("ic.actions.testSend")}</Button>}
          <Button variant="outline" data-testid={`ic-propose-${r.key}`} aria-expanded={panel === "propose"} onClick={() => setPanel(panel === "propose" ? "" : "propose")}>{t("ic.actions.propose")}</Button>
        </div>
      )}
      {panel === "send" && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); send.mutate({ key: r.key, to }, { onSuccess: () => { toast.success(t("ic.sent")); setPanel(""); }, onError: err }); }}>
          <label className="block text-xs font-semibold" htmlFor={`ic-to-${r.key}`}>{t("ic.testTo")}</label>
          <input id={`ic-to-${r.key}`} dir="ltr" className={field} value={to} onChange={(e) => setTo(e.target.value)} aria-describedby={`ic-toh-${r.key}`} required />
          <p id={`ic-toh-${r.key}`} className="text-xs text-muted-foreground">{t("ic.testToHint")}</p>
          <div className="flex gap-2"><Button type="submit" disabled={send.isPending || to.length < 3} data-testid={`ic-send-${r.key}`}>{send.isPending ? t("ic.actions.sending") : t("ic.send")}</Button><Button type="button" variant="outline" onClick={() => setPanel("")}>{t("ic.cancel")}</Button></div>
        </form>
      )}
      {panel === "propose" && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); propose.mutate({ key: r.key, mode, reason }, { onSuccess: () => { toast.success(t("ic.propose.done")); setPanel(""); setReason(""); }, onError: err }); }}>
          <p className="text-sm font-semibold">{t("ic.propose.title")}</p>
          <label className="block text-xs font-semibold" htmlFor={`ic-mode-sel-${r.key}`}>{t("ic.propose.mode")}</label>
          <select id={`ic-mode-sel-${r.key}`} className={field} value={mode} onChange={(e) => setMode(e.target.value as "mock" | "real")}><option value="mock">{t("ic.mode.mock")}</option><option value="real">{t("ic.mode.real")}</option></select>
          <label className="block text-xs font-semibold" htmlFor={`ic-reason-${r.key}`}>{t("ic.propose.reason")}</label>
          <textarea id={`ic-reason-${r.key}`} className={`${field} min-h-20 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
          <div className="flex gap-2"><Button type="submit" disabled={propose.isPending || reason.trim().length < 10} data-testid={`ic-submit-${r.key}`}>{t("ic.propose.submit")}</Button><Button type="button" variant="outline" onClick={() => setPanel("")}>{t("ic.cancel")}</Button></div>
        </form>
      )}
    </article>
  );
}
