import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FlaskConical, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useDeliveryTick, useMessageLog, useMessagingStats, useSimulateDelivery, type MessageState } from "@/api/ops";
import type { MessageLogItem } from "@/api/types";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader, StatTile } from "@/components/PageHeader";
import { formatDateTime } from "@/lib/format";

const CHANNELS = ["EMAIL", "WHATSAPP", "SMS", "PUSH"];
const STATUSES = ["QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "RECEIVED"];
const tone = (s: string) => (["DELIVERED", "READ"].includes(s) ? "success" : s === "FAILED" ? "destructive" : s === "QUEUED" ? "warning" : "secondary") as "success" | "destructive" | "warning" | "secondary";
const sel = "h-11 rounded-xl border border-input bg-card px-3 text-sm";

/** Unified message log (email / WhatsApp / SMS / push). In MESSAGING_MODE=mock nothing leaves the platform: simulate delivery states here. */
export default function MessagingPage() {
  const { t, i18n } = useTranslation();
  const [f, setF] = useState({ channel: "", status: "", direction: "" });
  const stats = useMessagingStats();
  const log = useMessageLog(f);
  const sim = useSimulateDelivery();
  const tick = useDeliveryTick();
  const mock = (log.data?.mode ?? stats.data?.mode) === "mock";
  const total = (pred: (c: { channel: string; direction: string; status: string }) => boolean) => (stats.data?.counts ?? []).filter(pred).reduce((n, c) => n + c.count, 0);
  const err = (e: unknown) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle"));
  const act = (m: MessageLogItem, state: MessageState) => sim.mutate({ id: m.id, state }, { onSuccess: () => toast.success(t("messaging.simulated", { state })), onError: err });
  return (
    <div>
      <PageHeader title={t("messaging.title")} hint={t("messaging.hint")} actions={
        <div className="flex items-center gap-2">
          {stats.data && <Badge variant={mock ? "warning" : "success"} data-testid="messaging-mode">{mock ? t("messaging.modeMock") : t("messaging.modeReal")}</Badge>}
          {mock && <Button variant="outline" disabled={tick.isPending} onClick={() => tick.mutate(undefined, { onSuccess: (r) => toast.success(t("messaging.ticked", { count: r.delivered })), onError: err })} data-testid="delivery-tick"><RefreshCw aria-hidden="true" />{t("messaging.tick")}</Button>}
        </div>} />
      {mock && <p role="note" className="mb-4 flex items-start gap-2 rounded-xl border border-dashed border-warning/60 bg-warning-soft px-4 py-2 text-sm text-warning" data-testid="messaging-mock-note"><FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{t("messaging.mockNote")}</p>}
      {stats.isLoading ? <CardSkeleton rows={1} /> : stats.error ? <ErrorState error={stats.error} onRetry={() => void stats.refetch()} /> : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="messaging-tiles">
          {CHANNELS.map((c) => <StatTile key={c} label={t(`messaging.channel.${c}`)} value={total((x) => x.channel === c)} />)}
          <StatTile label={t("messaging.delivered")} value={total((x) => x.direction === "OUT" && ["DELIVERED", "READ"].includes(x.status))} tone="ok" />
          <StatTile label={t("messaging.failed")} value={total((x) => x.status === "FAILED")} tone={total((x) => x.status === "FAILED") ? "warn" : undefined} />
          <StatTile label={t("messaging.inbound")} value={total((x) => x.direction === "IN")} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-3">
        <select aria-label={t("messaging.channelLabel")} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} className={sel}><option value="">{t("common.all")}</option>{CHANNELS.map((c) => <option key={c} value={c}>{t(`messaging.channel.${c}`)}</option>)}</select>
        <select aria-label={t("messaging.statusLabel")} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={sel}><option value="">{t("common.all")}</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select aria-label={t("messaging.directionLabel")} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} className={sel}><option value="">{t("common.all")}</option><option value="OUT">OUT</option><option value="IN">IN</option></select>
      </div>
      {log.isLoading ? <CardSkeleton rows={2} /> : log.error ? <ErrorState error={log.error} onRetry={() => void log.refetch()} /> : (
        <DataTable caption={t("messaging.title")} rows={log.data!.items} rowKey={(m) => m.id} empty={t("messaging.empty")} columns={[
          { key: "t", header: t("messaging.time"), cell: (m) => formatDateTime(m.createdAt, i18n.language) },
          { key: "c", header: t("messaging.channelLabel"), cell: (m) => <Badge variant="secondary">{m.channel}</Badge> },
          { key: "d", header: t("messaging.directionLabel"), cell: (m) => m.direction },
          { key: "r", header: t("messaging.recipient"), cell: (m) => <code className="text-xs" dir="ltr">{m.recipientMasked}</code> },
          { key: "tp", header: t("messaging.template"), cell: (m) => <code className="text-xs">{m.templateId ?? "—"}</code> },
          { key: "b", header: t("messaging.body"), cell: (m) => m.body ? <p className="max-w-xs truncate text-xs" title={m.body}>{m.body}</p> : <span className="text-muted-foreground">—</span> },
          { key: "s", header: t("messaging.statusLabel"), cell: (m) => <div className="space-y-1"><Badge variant={tone(m.status)} data-testid="msg-status">{m.status}</Badge>{m.error && <p className="text-xs text-destructive">{m.error}</p>}</div> },
          { key: "a", header: "", cell: (m) => mock && m.direction === "OUT" ? (
            <div className="flex gap-1">{(["DELIVERED", "READ", "FAILED"] as const).map((s) => <Button key={s} size="sm" variant="outline" disabled={sim.isPending || m.status === s} onClick={() => act(m, s)} data-testid={`sim-${s}`}>{t(`messaging.sim.${s}`)}</Button>)}</div>
          ) : null },
        ]} />
      )}
    </div>
  );
}
