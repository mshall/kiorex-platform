import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RotateCw, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/api/errors";
import { useLabBookingMonitor, usePharmacyOrderMonitor, useResolvePartial, useResubmitLab, useResubmitPharmacy } from "@/api/ops";
import { CardSkeleton, ErrorState, UnavailableState } from "@/components/states";
import { DataTable, type Column } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/auth/AuthProvider";
import { isSuperAdmin } from "@/auth/RequireOps";
import { formatBps, formatDateTime, formatMinor } from "@/lib/format";

const PHARM = ["PENDING_PAYMENT", "PAID", "SUBMITTED", "READY", "OUT_FOR_DELIVERY", "DISPENSED", "PARTIALLY_FULFILLED", "PARTIAL_REVIEW", "REJECTED", "CANCELLED"];
const LAB = ["PENDING_PAYMENT", "PAID", "SUBMITTED", "RESULT_RELEASED", "REJECTED", "CANCELLED"];
const tone = (s: string) => (["DISPENSED", "READY", "OUT_FOR_DELIVERY", "RESULT_RELEASED"].includes(s) ? "success" : ["REJECTED", "CANCELLED"].includes(s) ? "destructive" : ["PAID", "PARTIAL_REVIEW", "PENDING_PAYMENT"].includes(s) ? "warning" : "info") as "success" | "destructive" | "warning" | "info";
const sel = "mb-3 h-11 rounded-xl border border-input bg-card px-3 text-sm";

interface Row { id: string; status: string; sub: string; totalMinor: number; platformFeeMinor: number; takeRateBps: number; currency: string; createdAt: string; rejectionReason: string | null; summary: string; partnerName: string | null }

function Monitor({ kind, statuses }: { kind: "pharmacy" | "lab"; statuses: string[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState<Row | null>(null);
  const ph = usePharmacyOrderMonitor(kind === "pharmacy" ? status : "");
  const lb = useLabBookingMonitor(kind === "lab" ? status : "");
  const q = kind === "pharmacy" ? ph : lb;
  const rePh = useResubmitPharmacy(); const reLb = useResubmitLab(); const settle = useResolvePartial();
  const { user } = useAuth();
  const canAct = !!user && isSuperAdmin(user.roles);
  const rows: Row[] = ((kind === "pharmacy" ? ph.data : lb.data) ?? []).map((o) => ({
    id: o.id, status: o.status, sub: o.sub, totalMinor: o.totalMinor, platformFeeMinor: o.platformFeeMinor, takeRateBps: o.takeRateBps, currency: o.currency, createdAt: o.createdAt, rejectionReason: o.rejectionReason,
    partnerName: (o as { partnerName?: string | null }).partnerName ?? null, // which registered partner owns the order (per-registration routing)
    summary: "items" in o ? o.items.map((i) => `${i.name} ×${i.qty}`).join(", ") : o.tests.map((x) => x.code).join(", "),
  }));
  const resubmit = (r: Row) => (kind === "pharmacy" ? rePh : reLb).mutate(r.id, {
    onSuccess: (res) => { toast.success(t("orders.resubmitted", { status: res.status ?? "OK" })); setConfirm(null); },
    onError: (e) => { toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle")); setConfirm(null); },
  });
  const settlePartial = (r: Row) => settle.mutate(r.id, {
    onSuccess: (res) => toast.success(t("orders.settled", { amount: formatMinor(res.refundTotalMinor ?? 0, lang, r.currency) })),
    onError: (e) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle")),
  });
  if (q.error instanceof ApiError && q.error.isFeatureDisabled) return <UnavailableState featureKey={q.error.featureKey} />;
  const columns: Column<Row>[] = [
    { key: "id", header: t("orders.id"), cell: (r) => <code className="text-xs" dir="ltr">{r.id}</code> },
    { key: "s", header: t("orders.status"), cell: (r) => <div className="space-y-1"><Badge variant={tone(r.status)} data-testid="order-status">{r.status}</Badge>{r.rejectionReason && <p className="text-xs text-destructive">{r.rejectionReason}</p>}</div> },
    { key: "p", header: t("orders.partner"), cell: (r) => <span className="text-xs" dir="auto" data-testid="order-partner">{r.partnerName ?? "—"}</span> },
    { key: "i", header: t("orders.items"), cell: (r) => <p className="max-w-xs truncate text-xs" title={r.summary}>{r.summary}</p> },
    { key: "t", header: t("orders.total"), cell: (r) => formatMinor(r.totalMinor, lang, r.currency) },
    { key: "f", header: t("orders.fee"), cell: (r) => <span title={formatBps(r.takeRateBps, lang)}>{formatMinor(r.platformFeeMinor, lang, r.currency)} <span className="text-xs text-muted-foreground">({formatBps(r.takeRateBps, lang)})</span></span> },
    { key: "c", header: t("orders.created"), className: "whitespace-nowrap", cell: (r) => formatDateTime(r.createdAt, lang) },
    { key: "a", header: "", cell: (r) => r.status === "PAID" ? <Button size="sm" variant="outline" disabled={!canAct} onClick={() => setConfirm(r)} data-testid="resubmit"><RotateCw aria-hidden="true" />{t("orders.resubmit")}</Button> : kind === "pharmacy" && r.status === "PARTIAL_REVIEW" ? <Button size="sm" variant="outline" disabled={settle.isPending} onClick={() => settlePartial(r)} data-testid="settle-partial"><Scale aria-hidden="true" />{t("orders.settlePartial")}</Button> : null },
  ];
  return (
    <div>
      <select aria-label={t("orders.status")} value={status} onChange={(e) => setStatus(e.target.value)} className={sel}><option value="">{t("common.all")}</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
      {q.isLoading ? <CardSkeleton rows={1} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <DataTable caption={t(`orders.${kind}`)} rows={rows} rowKey={(r) => r.id} empty={t("orders.empty")} columns={columns} />}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent><DialogHeader><DialogTitle>{t("orders.resubmitTitle")}</DialogTitle><DialogDescription>{t("orders.resubmitBody")}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setConfirm(null)}>{t("common.cancel")}</Button><Button onClick={() => confirm && resubmit(confirm)} data-testid="confirm-resubmit">{t("orders.resubmit")}</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
}

/** Pharmacy-order and lab-booking monitors. A PAID order that never reached the partner (outage) is re-sent here; the API de-duplicates by Idempotency-Key. */
export default function OrdersPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t("orders.title")} hint={t("orders.hint")} />
      <Tabs defaultValue="pharmacy">
        <TabsList><TabsTrigger value="pharmacy" data-testid="tab-pharmacy" className="min-h-11 px-5">{t("orders.pharmacy")}</TabsTrigger><TabsTrigger value="lab" data-testid="tab-lab" className="min-h-11 px-5">{t("orders.lab")}</TabsTrigger></TabsList>
        <TabsContent value="pharmacy" className="mt-4"><Monitor kind="pharmacy" statuses={PHARM} /></TabsContent>
        <TabsContent value="lab" className="mt-4"><Monitor kind="lab" statuses={LAB} /></TabsContent>
      </Tabs>
    </div>
  );
}
