import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useCancelLabBooking, useLabBooking } from "@/api/features";
import { FlagScreen, RequireAuth } from "@/components/feature";
import { ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Row, Screen, T } from "@/components/ui";
import { useHostedPay } from "@/hooks/useHostedPay";
import { formatDayLong, formatMoney, formatTime } from "@/lib/format";
import { medName } from "@/lib/localName";
import { labCancellable, orderTone } from "@/lib/orders";

function Body({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const q = useLabBooking(id);
  const cancel = useCancelLabBooking();
  const { pay, busy } = useHostedPay(async () => (await q.refetch()).data, (b) => b.status !== "PENDING_PAYMENT");
  const [msg, setMsg] = useState<string | null>(null);
  const b = q.data;
  if (q.isLoading) return <LoadingState />;
  if (q.error || !b) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Screen testID="lab-booking" style={{ gap: 12 }}>
      <Card style={{ gap: 8 }}>
        <Row style={{ justifyContent: "space-between" }}><T variant="title" style={{ flex: 1 }} accessibilityRole="header">{t("lab.bookingTitle")}</T><Badge testID="lab-status" tone={orderTone(b.status)} label={t(`lab.status.${b.status}`)} /></Row>
        <T>{formatDayLong(b.slotStartsAt, lang)} · <T weight="bold">{formatTime(b.slotStartsAt, lang)}</T></T>
        <Badge tone="muted" icon={b.collectionType === "HOME" ? "pin" : "flask"} label={t(b.collectionType === "HOME" ? "lab.home" : "lab.walkIn")} />
      </Card>
      {msg ? <Banner tone="warning" body={msg} testID="lab-booking-message" /> : null}
      {b.status === "PENDING_PAYMENT" ? <Banner tone="warning" title={t("pharmacy.payTitle")} body={t("pharmacy.payBody")}><Button testID="pay-lab" icon="card" loading={busy} title={t("pharmacy.payNow", { amount: formatMoney(b.totalMinor / 100, lang) })} onPress={() => void pay(b.payment?.checkoutUrl).then((r) => setMsg(r === "pending" ? t("pharmacy.payPending") : r === "failed" ? t("pharmacy.payFailed") : null))} /></Banner> : null}
      {b.status === "RESULT_RELEASED" ? <Banner tone="success" testID="lab-result-ready" title={t("lab.resultReady")} body={t("lab.resultReadyBody")}>{b.resultRecordId ? <Button testID="open-result" icon="file" title={t("lab.openResult")} onPress={() => router.push(`/records/${b.resultRecordId}`)} /> : null}</Banner> : null}
      {b.status === "REJECTED" ? <Banner tone="danger" title={t("lab.rejectedTitle")} body={b.rejectionReason ?? t("pharmacy.rejectedBody")} /> : null}
      <Card style={{ gap: 8 }}>
        {b.tests.map((x) => <Row key={x.code} style={{ justifyContent: "space-between" }}><T style={{ flex: 1 }}>{medName(lang, x)}</T><T>{formatMoney(x.priceMinor / 100, lang)}</T></Row>)}
        <Row style={{ justifyContent: "space-between" }}><T variant="small" muted>{t("lab.collectionFee")}</T><T variant="small">{formatMoney(b.collectionFeeMinor / 100, lang)}</T></Row>
        <Row style={{ justifyContent: "space-between" }}><T weight="bold">{t("lab.total")}</T><T weight="bold">{formatMoney(b.totalMinor / 100, lang)}</T></Row>
      </Card>
      {labCancellable(b.status) ? <Button testID="cancel-lab" variant="danger" loading={cancel.isPending} title={t("lab.cancel")} onPress={() => cancel.mutate(b.id, { onSuccess: () => setMsg(t("pharmacy.cancelled")), onError: () => setMsg(t("pharmacy.cancelFailed")) })} /> : null}
    </Screen>
  );
}
export default function LabBooking() { const { id = "" } = useLocalSearchParams<{ id: string }>(); return <RequireAuth><FlagScreen flag="kiorex.lab_bookings"><Body id={id} /></FlagScreen></RequireAuth>; }
