import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, BadgeCheck, ChevronRight, Pill, RotateCcw, ScanSearch, Store, Truck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/api/errors";
import { useCancelPharmacyOrder, usePharmacyOrder, usePharmacyOrders, type PharmacyOrder } from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/states";
import { asPayment, PayPanel, ProgressSteps } from "@/components/OrderBits";
import { formatDateTime, formatMinor } from "@/lib/format";
import { useState } from "react";
import { medName } from "@/lib/localName";
import { IconTile, PageHeader, Row, StatusBanner, StatusChip, type Tone } from "@/components/kit";

const STEPS = ["PENDING_PAYMENT", "PAID", "SUBMITTED", "READY", "DISPENSED"];
/** DELIVERY orders have one more step (1.8.0): the courier hand-over between READY and DISPENSED. */
export const stepsFor = (o: { deliveryMethod: string }) => (o.deliveryMethod === "DELIVERY" ? ["PENDING_PAYMENT", "PAID", "SUBMITTED", "READY", "OUT_FOR_DELIVERY", "DISPENSED"] : STEPS);
/** Pickup and delivery orders say different things for READY / DISPENSED (ready for pickup vs ready for delivery; collected vs delivered). */
const statusPrefix = (o: { deliveryMethod: string }) => (o.deliveryMethod === "DELIVERY" ? "pharmacy.statusDelivery" : "pharmacy.statusPickup");
export const statusKey = (o: { status: string; deliveryMethod: string }) => (stepsFor(o).includes(o.status) ? `${statusPrefix(o)}.${o.status}` : `pharmacy.status.${o.status}`);
const REJECT_CODES = ["OUT_OF_STOCK", "RX_INVALID", "RX_UNKNOWN", "RX_REVOKED", "RX_NO_LONGER_SHARED", "CANNOT_DELIVER", "PHARMACY_REJECTED", "PHARMACY_EXPIRED", "PHARMACY_CANCELLED", "FEATURE_DISABLED"];
export const orderTone = (s: string): Tone => (s === "DISPENSED" || s === "READY" || s === "RESULT_RELEASED" ? "success" : s === "REJECTED" || s === "CANCELLED" ? "danger" : s === "PARTIAL_REVIEW" || s === "PARTIALLY_FULFILLED" || s === "PENDING_PAYMENT" ? "warning" : "info");
export const orderVariant = (s: string) => (s === "DISPENSED" || s === "READY" || s === "RESULT_RELEASED" ? "success" : s === "REJECTED" || s === "CANCELLED" ? "destructive" : s === "PARTIAL_REVIEW" || s === "PARTIALLY_FULFILLED" ? "warning" : "info") as "success" | "destructive" | "warning" | "info";

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
            <li key={o.id}><Link to={`/pharmacy/orders/${o.id}`} className="kx-card kx-card-interactive flex items-center gap-3 p-4" data-testid="order-row">
              <IconTile tone={orderTone(o.status)}>{o.deliveryMethod === "DELIVERY" ? <Truck /> : <Pill />}</IconTile>
              <div className="min-w-0 flex-1 space-y-0.5"><p className="truncate font-semibold">{o.items.map((i) => medName(i18n.language, i)).slice(0, 2).join("، ")}{o.items.length > 2 ? ` +${o.items.length - 2}` : ""}</p><p className="text-sm text-muted-foreground">{formatDateTime(o.createdAt, i18n.language)} · <span className="kx-label-num">{formatMinor(o.totalMinor, i18n.language)}</span></p></div>
              <StatusChip tone={orderTone(o.status)}>{t(statusKey(o))}</StatusChip><ChevronRight className="h-4 w-4 shrink-0 rtl-flip text-muted-foreground" aria-hidden="true" />
            </Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Itemised refund of a partially fulfilled order: which lines were refunded and why the total is what it is. */
function RefundCard({ refund, lang }: { refund: NonNullable<PharmacyOrder["refund"]>; lang: string }) {
  const { t } = useTranslation();
  const refunded = refund.lines.filter((l) => l.qtyRefunded > 0);
  return (
    <section className="kx-card space-y-2 p-5" aria-labelledby="refund-h" data-testid="order-refund">
      <div className="flex items-center justify-between gap-3"><h2 id="refund-h" className="flex items-center gap-2 text-lg"><RotateCcw className="h-5 w-5 text-info" aria-hidden="true" />{t("pharmacy.refund.title")}</h2><StatusChip tone={refund.status === "SETTLED" ? "success" : "info"} data-testid="refund-status">{t(`pharmacy.refund.status.${refund.status}`)}</StatusChip></div>
      <p className="text-sm text-muted-foreground">{t("pharmacy.refund.intro")}</p>
      <ul className="divide-y" data-testid="refund-lines">{refunded.map((l) => <li key={l.sku} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="min-w-0"><span className="font-medium"><bdi>{medName(lang, l)}</bdi></span> <span className="text-muted-foreground kx-label-num">× {l.qtyRefunded} {t("pharmacy.refund.ofOrdered", { count: l.qtyOrdered })}</span></span><span className="kx-label-num">−{formatMinor(l.refundMinor, lang, refund.currency)}</span></li>)}
        {refund.deliveryFeeMinor > 0 && <li className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="font-medium">{t("pharmacy.refund.deliveryFee")}</span><span className="kx-label-num">−{formatMinor(refund.deliveryFeeMinor, lang, refund.currency)}</span></li>}</ul>
      <dl className="border-t pt-2"><Row label={t("pharmacy.refund.fulfilled")}>{formatMinor(refund.fulfilledMinor, lang, refund.currency)}</Row><Row label={t("pharmacy.refund.total")} strong><span data-testid="refund-total">{formatMinor(refund.totalMinor, lang, refund.currency)}</span></Row></dl>
    </section>
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
  const Hero = o.status === "REJECTED" || o.status === "CANCELLED" ? XCircle : o.status === "DISPENSED" || o.status === "READY" || o.status === "PARTIALLY_FULFILLED" ? BadgeCheck : o.deliveryMethod === "DELIVERY" ? Truck : Pill;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/pharmacy/orders" className="inline-flex min-h-11 items-center gap-1 text-sm text-ocean"><Back className="h-4 w-4" aria-hidden="true" />{t("pharmacy.ordersTitle")}</Link>
      <header className="kx-card flex items-center gap-4 p-5">
        <IconTile tone={orderTone(o.status)} className="h-14 w-14 rounded-2xl [&_svg]:h-7 [&_svg]:w-7"><Hero /></IconTile>
        <div className="min-w-0 flex-1"><h1 className="text-xl md:text-2xl">{t("pharmacy.orderTitle")}</h1><p className="text-sm text-muted-foreground">{formatDateTime(o.createdAt, i18n.language)} · <span className="kx-label-num">{formatMinor(o.totalMinor, i18n.language)}</span></p></div>
        <StatusChip tone={orderTone(o.status)} data-testid="order-status">{t(statusKey(o))}</StatusChip>
      </header>

      {o.status === "REJECTED" && <StatusBanner tone="danger" icon={<XCircle />} title={t("pharmacy.rejectedTitle")} data-testid="order-rejected"><p data-testid="reject-reason">{t(`pharmacy.rejectReason.${REJECT_CODES.includes(o.rejectionReason ?? "") ? o.rejectionReason : "OTHER"}`)}</p><p className="flex items-center gap-1.5 font-medium text-foreground"><RotateCcw className="h-4 w-4 text-info" aria-hidden="true" />{t("pharmacy.autoRefund")}</p></StatusBanner>}
      {o.status === "PARTIAL_REVIEW" && <StatusBanner tone="warning" icon={<ScanSearch />} data-testid="order-partial">{t("pharmacy.partialReview")}</StatusBanner>}
      {refunded && o.status === "CANCELLED" && <StatusBanner tone="info" icon={<RotateCcw />} data-testid="order-refunded">{t("pharmacy.refundedNote")}</StatusBanner>}
      {o.rxStatus === "INVALID" && <StatusBanner tone="danger" icon={<ScanSearch />}>{t("pharmacy.rxInvalid")}</StatusBanner>}
      {o.status === "OUT_FOR_DELIVERY" && <StatusBanner tone="info" icon={<Truck />} title={t(statusKey(o))} data-testid="order-out-for-delivery">{o.outForDeliveryAt && <p>{t("pharmacy.outForDeliveryAt")} {formatDateTime(o.outForDeliveryAt, i18n.language)}</p>}<p>{t("pharmacy.outForDeliveryHint")}</p></StatusBanner>}
      {(o.status === "READY" || o.status === "DISPENSED" || o.status === "PARTIALLY_FULFILLED") && <StatusBanner tone="success" icon={<Store />} title={t(statusKey(o))}>{o.readyAt && <p>{t("pharmacy.readyAt")} {formatDateTime(o.readyAt, i18n.language)}</p>}{o.dispensedAt && <p>{t("pharmacy.handedOverAt")} {formatDateTime(o.dispensedAt, i18n.language)}</p>}</StatusBanner>}

      <div className="kx-card p-5 sm:px-6"><ProgressSteps steps={stepsFor(o)} current={o.status === "PARTIALLY_FULFILLED" ? "DISPENSED" : o.status} failed={failed} i18nPrefix={statusPrefix(o)} /></div>
      {o.status === "PENDING_PAYMENT" && <PayPanel payment={pay} label={t("pharmacy.pay", { total: formatMinor(o.totalMinor, i18n.language) })} />}

      <section className="kx-card space-y-2 p-5" aria-labelledby="items-h">
        <h2 id="items-h" className="text-lg">{t("pharmacy.items")}</h2>
        <ul className="divide-y">{o.items.map((i) => <li key={i.sku} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span className="flex min-w-0 flex-wrap items-center gap-2" ><span className="font-medium"><bdi>{medName(i18n.language, i)}</bdi></span><span className="text-muted-foreground kx-label-num">× {i.qty}</span>{i.rxRequired && <StatusChip tone="warning" dot={false}>{t("pharmacy.rx")}</StatusChip>}</span><span className="kx-label-num">{formatMinor(i.unitPriceMinor * i.qty, i18n.language)}</span></li>)}</ul>
        <dl className="border-t pt-2">
          <Row label={t("pharmacy.deliveryChoice")}><span className="font-sans">{t(`pharmacy.method.${o.deliveryMethod}`)}</span></Row>
          {o.deliveryMethod === "DELIVERY" && o.deliveryAddress && <Row label={t("pharmacy.deliverTo")}><span className="font-sans" data-testid="order-address"><bdi>{[o.deliveryAddress.line1, o.deliveryAddress.area, o.deliveryAddress.governorate].filter(Boolean).join(", ")}</bdi></span></Row>}
          <Row label={t("pharmacy.deliveryFee")}>{o.deliveryFeeMinor ? formatMinor(o.deliveryFeeMinor, i18n.language) : t("p3.free")}</Row>
          {o.rxStatus !== "NOT_REQUIRED" && <Row label={t("pharmacy.rxStatus")}><span className="font-sans">{t(`pharmacy.rxState.${o.rxStatus}`)}</span></Row>}
          <Row label={t("pharmacy.total")} strong>{formatMinor(o.totalMinor, i18n.language)}</Row>
        </dl>
      </section>
      {o.refund && <RefundCard refund={o.refund} lang={i18n.language} />}
      {cancellable && <Button variant="outline" onClick={() => setCancelling(true)} data-testid="cancel-order">{t("pharmacy.cancelOrder")}</Button>}
      <CancelDialog order={o} open={cancelling} onClose={() => setCancelling(false)} />
    </div>
  );
}
