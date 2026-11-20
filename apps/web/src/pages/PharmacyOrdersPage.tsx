import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ChevronRight, Pill } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/api/errors";
import { useCancelPharmacyOrder, usePharmacyOrder, usePharmacyOrders, type PharmacyOrder } from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/states";
import { asPayment, PayPanel, ProgressSteps } from "@/components/OrderBits";
import { formatDateTime, formatMinor } from "@/lib/format";
import { useState } from "react";
import { PageHeader } from "@/components/kit";

const STEPS = ["PENDING_PAYMENT", "PAID", "SUBMITTED", "READY", "DISPENSED"];
export const orderVariant = (s: string) => (s === "DISPENSED" || s === "READY" || s === "RESULT_RELEASED" ? "success" : s === "REJECTED" || s === "CANCELLED" ? "destructive" : s === "PARTIAL_REVIEW" ? "warning" : "info") as "success" | "destructive" | "warning" | "info";

export function PharmacyOrdersPage() {
  const { t, i18n } = useTranslation();
  const q = usePharmacyOrders();
  return (
    <div className="space-y-5">
      <PageHeader title={t("pharmacy.ordersTitle")} />
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? (
        <EmptyState icon={<Pill className="h-10 w-10" aria-hidden="true" />} title={t("pharmacy.ordersEmpty")} action={<Link to="/pharmacy" className="text-ocean underline">{t("pharmacy.title")}</Link>} />
      ) : (
        <ul className="space-y-3" data-testid="order-list">
          {q.data!.map((o) => (
            <li key={o.id}><Link to={`/pharmacy/orders/${o.id}`} className="kx-card kx-card-interactive flex items-center justify-between gap-3 p-4" data-testid="order-row">
              <div className="space-y-1"><p className="font-semibold">{o.items.map((i) => i.name).slice(0, 2).join("، ")}{o.items.length > 2 ? ` +${o.items.length - 2}` : ""}</p><p className="text-sm text-muted-foreground">{formatDateTime(o.createdAt, i18n.language)} · {formatMinor(o.totalMinor, i18n.language)}</p></div>
              <div className="flex items-center gap-2"><Badge variant={orderVariant(o.status)}>{t(`pharmacy.status.${o.status}`)}</Badge><ChevronRight className="h-4 w-4 rtl-flip text-muted-foreground" aria-hidden="true" /></div>
            </Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CancelDialog({ order, open, onClose }: { order: PharmacyOrder; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const cancel = useCancelPharmacyOrder();
  const paid = order.status !== "PENDING_PAYMENT";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("pharmacy.cancelTitle")}</DialogTitle><DialogDescription>{paid ? t("pharmacy.cancelPaid") : t("pharmacy.cancelUnpaid")}</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("appointment.keep")}</Button>
          <Button variant="destructive" disabled={cancel.isPending} data-testid="confirm-cancel-order" onClick={() => cancel.mutate(order.id, { onSuccess: () => { toast.success(t("pharmacy.cancelled")); onClose(); }, onError: (e) => toast.error(e instanceof ApiError && e.status === 409 ? t("pharmacy.cancelTooLate") : t("pharmacy.errors.generic")) })}>{t("pharmacy.cancelConfirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PharmacyOrderPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const q = usePharmacyOrder(id);
  const [cancelling, setCancelling] = useState(false);
  const Back = i18n.language.startsWith("ar") ? ArrowRight : ArrowLeft;
  if (q.isLoading) return <LoadingState />;
  if (q.error) return q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title={t("pharmacy.orderNotFound")} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data!;
  const pay = asPayment(o.payment);
  const failed = ["REJECTED", "CANCELLED", "PARTIAL_REVIEW"].includes(o.status) ? o.status : null;
  const cancellable = ["PENDING_PAYMENT", "PAID", "SUBMITTED"].includes(o.status);
  const refunded = (o.status === "REJECTED" || o.status === "CANCELLED") && pay?.status !== "CREATED" && !!pay;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/pharmacy/orders" className="inline-flex min-h-11 items-center gap-1 text-sm text-ocean"><Back className="h-4 w-4" aria-hidden="true" />{t("pharmacy.ordersTitle")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl">{t("pharmacy.orderTitle")}</h1><Badge variant={orderVariant(o.status)} data-testid="order-status">{t(`pharmacy.status.${o.status}`)}</Badge></div>

      {o.status === "REJECTED" && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="order-rejected"><p className="font-semibold">{t("pharmacy.rejectedTitle")}</p><p>{o.rejectionReason ?? t("pharmacy.rejectedBody")}</p><p className="mt-1 text-muted-foreground">{t("pharmacy.autoRefund")}</p></div>}
      {o.status === "PARTIAL_REVIEW" && <div role="status" className="rounded-xl border border-warning/50 bg-warning-soft p-4 text-sm" data-testid="order-partial">{t("pharmacy.partialReview")}</div>}
      {refunded && o.status === "CANCELLED" && <div role="status" className="rounded-xl border bg-muted p-4 text-sm" data-testid="order-refunded">{t("pharmacy.refundedNote")}</div>}
      {o.rxStatus === "INVALID" && <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm">{t("pharmacy.rxInvalid")}</div>}

      <div className="kx-card p-5"><ProgressSteps steps={STEPS} current={o.status} failed={failed} i18nPrefix="pharmacy.status" /></div>
      {o.status === "PENDING_PAYMENT" && <PayPanel payment={pay} label={t("pharmacy.pay", { total: formatMinor(o.totalMinor, i18n.language) })} />}

      <section className="kx-card space-y-3 p-5" aria-labelledby="items-h">
        <h2 id="items-h" className="text-lg">{t("pharmacy.items")}</h2>
        <ul className="divide-y">{o.items.map((i) => <li key={i.sku} className="flex justify-between gap-3 py-2 text-sm"><span>{i.name} × {i.qty}{i.rxRequired && <Badge variant="warning" className="ms-2">{t("pharmacy.rx")}</Badge>}</span><span className="kx-label-num">{formatMinor(i.unitPriceMinor * i.qty, i18n.language)}</span></li>)}</ul>
        <dl className="space-y-1 border-t pt-3 text-sm">
          <div className="flex justify-between"><dt>{t("pharmacy.deliveryChoice")}</dt><dd>{t(`pharmacy.method.${o.deliveryMethod}`)}</dd></div>
          <div className="flex justify-between"><dt>{t("pharmacy.deliveryFee")}</dt><dd className="kx-label-num">{formatMinor(o.deliveryFeeMinor, i18n.language)}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>{t("pharmacy.total")}</dt><dd className="kx-label-num">{formatMinor(o.totalMinor, i18n.language)}</dd></div>
          {o.rxStatus !== "NOT_REQUIRED" && <div className="flex justify-between"><dt>{t("pharmacy.rxStatus")}</dt><dd>{t(`pharmacy.rxState.${o.rxStatus}`)}</dd></div>}
          {o.readyAt && <div className="flex justify-between"><dt>{t("pharmacy.readyAt")}</dt><dd>{formatDateTime(o.readyAt, i18n.language)}</dd></div>}
        </dl>
      </section>
      {cancellable && <Button variant="outline" onClick={() => setCancelling(true)} data-testid="cancel-order">{t("pharmacy.cancelOrder")}</Button>}
      <CancelDialog order={o} open={cancelling} onClose={() => setCancelling(false)} />
    </div>
  );
}
