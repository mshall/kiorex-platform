import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { type CheckItem, type WebhookInfo, useChannelActions, useChannelsStatus, useWaTemplates, useWebhookInfo } from "@/api/messagingChannels";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";

const field = "h-11 rounded-xl border border-input bg-card px-3 text-sm";

/**
 * Real messaging channels (MSG-REAL): readiness of WhatsApp / SMS / e-mail / push, the values to paste into the Meta / SES / SMS consoles, a TEST SEND to an allow-listed internal address,
 * a read-only CONNECTION CHECK and the WhatsApp template registry. Secrets never appear here: only secretRef names and "set / not set".
 */
export default function MessagingChannelsPage() {
  const { t } = useTranslation();
  const status = useChannelsStatus(); const a = useChannelActions(); const tpl = useWaTemplates();
  const [sel, setSel] = useState<string | null>(null);
  const [to, setTo] = useState(""); const [revealed, setRevealed] = useState<WebhookInfo | null>(null);
  const [checks, setChecks] = useState<{ channel: string; ok: boolean; items: CheckItem[] } | null>(null);
  const info = useWebhookInfo(sel);
  const err = (e: unknown) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle"));
  const current = status.data?.channels.find((c) => c.channel === sel);
  const shown = revealed && revealed.channel === sel ? revealed : info.data;
  const download = async () => { const rows = await a.exportTemplates.mutateAsync().catch((e) => { err(e); return null; }); if (!rows) return; const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" })); const l = document.createElement("a"); l.href = url; l.download = "whatsapp-templates-for-approval.json"; l.click(); URL.revokeObjectURL(url); };
  return (
    <div>
      <PageHeader title={t("messaging.channels.title")} hint={t("messaging.channels.hint")} actions={<Link className="text-sm underline" to="/messaging">{t("messaging.channels.backToLog")}</Link>} />
      {status.isLoading ? <CardSkeleton rows={3} /> : status.error ? <ErrorState error={status.error} onRetry={() => void status.refetch()} /> : (
        <>
          <DataTable caption={t("messaging.channels.title")} rows={status.data!.channels} rowKey={(c) => c.channel} empty="-" columns={[
            { key: "c", header: t("messaging.channelLabel"), cell: (c) => <button className="font-semibold underline" onClick={() => { setSel(c.channel); setRevealed(null); setChecks(null); }} data-testid={`channel-${c.channel}`}>{t(`messaging.channel.${c.channel}`)}</button> },
            { key: "m", header: t("messaging.channels.mode"), cell: (c) => <Badge variant={c.mode === "real" ? "success" : "warning"}>{t(c.mode === "real" ? "messaging.modeReal" : "messaging.modeMock")}</Badge> },
            { key: "r", header: t("messaging.channels.ready"), cell: (c) => <Badge variant={c.ready ? "success" : "destructive"}>{c.ready ? t("messaging.channels.readyYes") : t("messaging.channels.readyNo")}</Badge> },
            { key: "p", header: t("messaging.channels.providers"), cell: (c) => <span className="text-xs" dir="ltr">{c.providers.map((p) => p.provider).join(" > ")}</span> },
            { key: "s", header: t("messaging.channels.sender"), cell: (c) => <code className="text-xs" dir="ltr">{c.senderId ?? "—"}</code> },
            { key: "pr", header: t("messaging.channels.problems"), cell: (c) => { const p = c.providers.flatMap((x) => x.problems); return p.length ? <ul className="list-disc ps-4 text-xs text-destructive" dir="ltr">{p.map((x) => <li key={x}>{x}</li>)}</ul> : <span className="text-muted-foreground">—</span>; } },
          ]} />
          <p className="mt-2 text-xs text-muted-foreground" data-testid="channels-order">{t("messaging.channels.failover")}: {Object.entries(status.data!.failoverOrder ?? {}).map(([k, v]) => `${k}: ${(v as string[]).join(" > ") || "—"}`).join(" · ")}</p>
        </>
      )}
      {sel && current && (
        <section className="mt-6 grid gap-4 lg:grid-cols-2" aria-label={sel} data-testid="channel-detail">
          <div className="rounded-2xl border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">{t("messaging.channels.webhook")}</h2>
            {info.isLoading ? <CardSkeleton rows={1} /> : shown ? (
              <div className="space-y-2 text-sm">
                {(shown.callbackUrl ?? shown.subscriptionUrl) && <p><span className="text-muted-foreground">{t("messaging.channels.url")}</span><br /><code className="break-all text-xs" dir="ltr" data-testid="webhook-url">{shown.callbackUrl ?? shown.subscriptionUrl}</code></p>}
                {shown.verifyTokenSet !== undefined && <p><span className="text-muted-foreground">{t("messaging.channels.verifyToken")}</span><br /><code className="text-xs" dir="ltr" data-testid="verify-token">{shown.verifyToken ?? t("messaging.channels.notSet")}</code></p>}
                {shown.subscribeFields && <p className="text-xs" dir="ltr">{t("messaging.channels.fields")}: {shown.subscribeFields.join(", ")}</p>}
                <ol className="list-decimal ps-4 text-xs text-muted-foreground">{(shown.steps ?? []).map((s) => <li key={s}>{s}</li>)}</ol>
                {shown.note && <p className="text-xs text-muted-foreground">{shown.note}</p>}
                {sel !== "PUSH" && <Button variant="outline" disabled={a.reveal.isPending} onClick={() => a.reveal.mutate(sel, { onSuccess: setRevealed, onError: err })} data-testid="reveal">{t("messaging.channels.reveal")}</Button>}
              </div>
            ) : null}
          </div>
          <div className="rounded-2xl border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">{t("messaging.channels.test")}</h2>
            <p className="mb-2 text-xs text-muted-foreground">{t("messaging.channels.testHint", { n: status.data?.testAllowListSize ?? 0 })}</p>
            <div className="flex flex-wrap gap-2">
              <input className={field} dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} placeholder={sel === "EMAIL" ? "owner@example.com" : sel === "PUSH" ? "device token" : "+201001234567"} aria-label={t("messaging.channels.to")} data-testid="test-to" />
              <Button disabled={!to || a.testSend.isPending} onClick={() => a.testSend.mutate({ channel: sel, to }, { onSuccess: (r) => (r.ok ? toast.success(`${r.status} (${r.mode})`) : toast.error(`${r.error}${r.hint ? `: ${r.hint}` : ""}`)), onError: err })} data-testid="test-send">{t("messaging.channels.testSend")}</Button>
              <Button variant="outline" disabled={a.check.isPending} onClick={() => a.check.mutate(sel, { onSuccess: (r) => setChecks({ channel: r.channel, ok: r.ok, items: r.checks }), onError: err })} data-testid="connection-check">{t("messaging.channels.check")}</Button>
            </div>
            {checks && checks.channel === sel && (
              <ul className="mt-3 space-y-1 text-xs" data-testid="check-results" aria-live="polite">
                {checks.items.map((c) => <li key={c.name} className="flex gap-2"><Badge variant={c.skipped ? "secondary" : c.ok ? "success" : "destructive"}>{c.skipped ? t("messaging.channels.skipped") : c.ok ? "OK" : "FAIL"}</Badge><span><strong>{c.name}</strong>: <span dir="ltr">{c.detail}</span></span></li>)}
              </ul>
            )}
          </div>
        </section>
      )}
      <section className="mt-6" aria-label={t("messaging.channels.templates")}>
        <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{t("messaging.channels.templates")}</h2>
          <div className="flex gap-2"><Button variant="outline" onClick={() => a.sync.mutate(undefined, { onSuccess: (r) => toast.success(t("messaging.channels.synced", { n: r.updated })), onError: err })} data-testid="templates-sync">{t("messaging.channels.sync")}</Button><Button variant="outline" onClick={() => void download()} data-testid="templates-export">{t("messaging.channels.export")}</Button></div></div>
        {tpl.isLoading ? <CardSkeleton rows={2} /> : tpl.error ? <ErrorState error={tpl.error} onRetry={() => void tpl.refetch()} /> : (
          <DataTable caption={t("messaging.channels.templates")} rows={tpl.data!} rowKey={(r) => `${r.key}:${r.language}`} empty="-" columns={[
            { key: "k", header: t("messaging.template"), cell: (r) => <code className="text-xs" dir="ltr">{r.key}</code> },
            { key: "l", header: t("messaging.channels.language"), cell: (r) => r.language },
            { key: "n", header: t("messaging.channels.metaName"), cell: (r) => <code className="text-xs" dir="ltr">{r.metaName}</code> },
            { key: "c", header: t("messaging.channels.category"), cell: (r) => r.category },
            { key: "s", header: t("messaging.statusLabel"), cell: (r) => <Badge variant={r.status === "APPROVED" ? "success" : ["REJECTED", "PAUSED", "DISABLED", "FLAGGED"].includes(r.status) ? "destructive" : "secondary"}>{r.status}</Badge> },
          ]} />
        )}
      </section>
    </div>
  );
}
