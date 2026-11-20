import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarClock, ChevronRight, FileText, FlaskConical, Home, RotateCcw, XCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useCancelLab, useLabBooking, useLabBookings } from "@/api/services";
import { CardSkeleton, EmptyState, ErrorState, LoadingState } from "@/components/states";
import { asPayment, PayPanel, ProgressSteps } from "@/components/OrderBits";
import { orderTone } from "@/pages/PharmacyOrdersPage";
import { formatDateTime, formatMinor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IconTile, PageHeader, Row, StatusBanner, StatusChip } from "@/components/kit";

const STEPS = ["PENDING_PAYMENT", "PAID", "SUBMITTED", "RESULT_RELEASED"];

export function LabBookingsPage() {
  const { t, i18n } = useTranslation();
  const q = useLabBookings();
  return (
    <div className="space-y-5">
      <PageHeader title={t("lab.bookingsTitle")} />
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.length === 0 ? (
        <EmptyState icon={<FlaskConical className="h-10 w-10" aria-hidden="true" />} title={t("lab.bookingsEmpty")} action={<Link to="/lab" className={cn(buttonVariants())}>{t("lab.title")}</Link>} />
      ) : (
        <ul className="space-y-3" data-testid="lab-booking-list">
          {q.data!.map((b) => (
            <li key={b.id}><Link to={`/lab/bookings/${b.id}`} className="kx-card kx-card-interactive flex items-center gap-3 p-4" data-testid="lab-booking-row">
              <IconTile tone={orderTone(b.status)}>{b.collectionType === "HOME" ? <Home /> : <FlaskConical />}</IconTile>
              <div className="min-w-0 flex-1 space-y-0.5"><p className="truncate font-semibold">{b.tests.map((x) => x.name).join("، ")}</p><p className="text-sm text-muted-foreground">{formatDateTime(b.slotStartsAt, i18n.language)} · <span className="kx-label-num">{formatMinor(b.totalMinor, i18n.language)}</span></p></div>
              <StatusChip tone={orderTone(b.status)}>{t(`lab.status.${b.status}`)}</StatusChip><ChevronRight className="h-4 w-4 shrink-0 rtl-flip text-muted-foreground" aria-hidden="true" />
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
      <header className="kx-card flex items-center gap-4 p-5">
        <IconTile tone={orderTone(b.status)} className="h-14 w-14 rounded-2xl [&_svg]:h-7 [&_svg]:w-7">{failed ? <XCircle /> : b.status === "RESULT_RELEASED" ? <BadgeCheck /> : <FlaskConical />}</IconTile>
        <div className="min-w-0 flex-1"><h1 className="text-xl md:text-2xl">{t("lab.bookingTitle")}</h1><p className="flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarClock className="h-4 w-4" aria-hidden="true" />{formatDateTime(b.slotStartsAt, i18n.language)}</p></div>
        <StatusChip tone={orderTone(b.status)} data-testid="lab-status">{t(`lab.status.${b.status}`)}</StatusChip>
      </header>
      {b.status === "REJECTED" && <StatusBanner tone="danger" icon={<XCircle />} title={t("lab.rejectedTitle")} data-testid="lab-rejected"><p>{b.rejectionReason ?? t("lab.rejectedBody")}</p><p className="flex items-center gap-1.5 font-medium text-foreground"><RotateCcw className="h-4 w-4 text-info" aria-hidden="true" />{t("pharmacy.autoRefund")}</p></StatusBanner>}
      {b.status === "RESULT_RELEASED" && (
        <StatusBanner tone="success" icon={<FileText />} title={t("lab.resultReady")} data-testid="lab-result-ready"><p>{t("lab.resultReadyBody")}</p>
          {b.resultRecordId && <Link to={`/records/${b.resultRecordId}`} className={cn(buttonVariants({ size: "sm" }), "mt-2")} data-testid="lab-result-link">{t("lab.openResult")}</Link>}</StatusBanner>
      )}
      <div className="kx-card p-5 sm:px-6"><ProgressSteps steps={STEPS} current={b.status} failed={failed} i18nPrefix="lab.status" /></div>
      {b.status === "PENDING_PAYMENT" && <PayPanel payment={pay} label={t("pharmacy.pay", { total: formatMinor(b.totalMinor, i18n.language) })} />}
      <section className="kx-card space-y-2 p-5">
        <h2 className="text-lg">{t("lab.testsInBooking")}</h2>
        <ul className="divide-y">{b.tests.map((x) => <li key={x.code} className="flex justify-between gap-3 py-2.5 text-sm"><span className="font-medium" >{x.name}</span><span className="kx-label-num">{formatMinor(x.priceMinor, i18n.language)}</span></li>)}</ul>
        <dl className="border-t pt-2">
          <Row label={t("lab.collection")}><span className="font-sans">{t(`lab.collectionType.${b.collectionType}`)}</span></Row>
          <Row label={t("lab.when")}><span className="font-sans">{formatDateTime(b.slotStartsAt, i18n.language)}</span></Row>
          {b.collectionFeeMinor > 0 && <Row label={t("lab.collectionFee")}>{formatMinor(b.collectionFeeMinor, i18n.language)}</Row>}
          <Row label={t("pharmacy.total")} strong>{formatMinor(b.totalMinor, i18n.language)}</Row>
        </dl>
      </section>
      {cancellable && <Button variant="outline" disabled={cancel.isPending} data-testid="cancel-lab" onClick={() => cancel.mutate(b.id, { onSuccess: () => toast.success(t("lab.cancelled")), onError: () => toast.error(t("lab.errors.generic")) })}>{t("lab.cancel")}</Button>}
    </div>
  );
}
