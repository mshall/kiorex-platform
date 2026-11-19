import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ChevronRight, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useCancelLab, useLabBooking, useLabBookings } from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/states";
import { asPayment, PayPanel, ProgressSteps } from "@/components/OrderBits";
import { orderVariant } from "@/pages/PharmacyOrdersPage";
import { formatDateTime, formatMinor } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS = ["PENDING_PAYMENT", "PAID", "SUBMITTED", "RESULT_RELEASED"];

export function LabBookingsPage() {
  const { t, i18n } = useTranslation();
  const q = useLabBookings();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl">{t("lab.bookingsTitle")}</h1>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? (
        <EmptyState icon={<FlaskConical className="h-10 w-10" aria-hidden="true" />} title={t("lab.bookingsEmpty")} action={<Link to="/lab" className={cn(buttonVariants())}>{t("lab.title")}</Link>} />
      ) : (
        <ul className="space-y-3" data-testid="lab-booking-list">
          {q.data!.map((b) => (
            <li key={b.id}><Link to={`/lab/bookings/${b.id}`} className="kx-card flex items-center justify-between gap-3 p-4 hover:border-primary" data-testid="lab-booking-row">
              <div className="space-y-1"><p className="font-semibold">{b.tests.map((x) => x.name).join("، ")}</p><p className="text-sm text-muted-foreground">{formatDateTime(b.slotStartsAt, i18n.language)} · {formatMinor(b.totalMinor, i18n.language)}</p></div>
              <div className="flex items-center gap-2"><Badge variant={orderVariant(b.status)}>{t(`lab.status.${b.status}`)}</Badge><ChevronRight className="h-4 w-4 rtl-flip text-muted-foreground" aria-hidden="true" /></div>
            </Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LabBookingPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const q = useLabBooking(id);
  const cancel = useCancelLab();
  const Back = i18n.language.startsWith("ar") ? ArrowRight : ArrowLeft;
  if (q.isLoading) return <LoadingState />;
  if (q.error) return q.error instanceof ApiError && q.error.status === 404 ? <EmptyState title={t("lab.notFound")} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const b = q.data!;
  const failed = b.status === "REJECTED" || b.status === "CANCELLED" ? b.status : null;
  const pay = asPayment(b.payment);
  const cancellable = ["PENDING_PAYMENT", "PAID", "SUBMITTED"].includes(b.status);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/lab/bookings" className="inline-flex min-h-11 items-center gap-1 text-sm text-ocean"><Back className="h-4 w-4" aria-hidden="true" />{t("lab.bookingsTitle")}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl">{t("lab.bookingTitle")}</h1><Badge variant={orderVariant(b.status)} data-testid="lab-status">{t(`lab.status.${b.status}`)}</Badge></div>
      {b.status === "REJECTED" && <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm" data-testid="lab-rejected"><p className="font-semibold">{t("lab.rejectedTitle")}</p><p>{b.rejectionReason ?? t("lab.rejectedBody")}</p><p className="mt-1 text-muted-foreground">{t("pharmacy.autoRefund")}</p></div>}
      {b.status === "RESULT_RELEASED" && (
        <div role="status" className="rounded-xl border border-success/40 bg-success-soft p-4 text-sm" data-testid="lab-result-ready"><p className="font-semibold text-success">{t("lab.resultReady")}</p><p>{t("lab.resultReadyBody")}</p>
          {b.resultRecordId && <Link to={`/records/${b.resultRecordId}`} className={cn(buttonVariants({ size: "sm" }), "mt-3")} data-testid="lab-result-link">{t("lab.openResult")}</Link>}</div>
      )}
      <div className="kx-card p-5"><ProgressSteps steps={STEPS} current={b.status} failed={failed} i18nPrefix="lab.status" /></div>
      {b.status === "PENDING_PAYMENT" && <PayPanel payment={pay} label={t("pharmacy.pay", { total: formatMinor(b.totalMinor, i18n.language) })} />}
      <section className="kx-card space-y-3 p-5">
        <h2 className="text-lg">{t("lab.testsInBooking")}</h2>
        <ul className="divide-y">{b.tests.map((x) => <li key={x.code} className="flex justify-between py-2 text-sm"><span>{x.name}</span><span className="kx-label-num">{formatMinor(x.priceMinor, i18n.language)}</span></li>)}</ul>
        <dl className="space-y-1 border-t pt-3 text-sm">
          <div className="flex justify-between"><dt>{t("lab.collection")}</dt><dd>{t(`lab.collectionType.${b.collectionType}`)}</dd></div>
          <div className="flex justify-between"><dt>{t("lab.when")}</dt><dd>{formatDateTime(b.slotStartsAt, i18n.language)}</dd></div>
          {b.collectionFeeMinor > 0 && <div className="flex justify-between"><dt>{t("lab.collectionFee")}</dt><dd className="kx-label-num">{formatMinor(b.collectionFeeMinor, i18n.language)}</dd></div>}
          <div className="flex justify-between text-base font-semibold"><dt>{t("pharmacy.total")}</dt><dd className="kx-label-num">{formatMinor(b.totalMinor, i18n.language)}</dd></div>
        </dl>
      </section>
      {cancellable && <Button variant="outline" disabled={cancel.isPending} data-testid="cancel-lab" onClick={() => cancel.mutate(b.id, { onSuccess: () => toast.success(t("lab.cancelled")), onError: () => toast.error(t("lab.errors.generic")) })}>{t("lab.cancel")}</Button>}
    </div>
  );
}
