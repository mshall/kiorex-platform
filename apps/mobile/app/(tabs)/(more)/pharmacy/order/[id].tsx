import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useCancelPharmacyOrder, usePharmacyOrder } from "@/api/features";
import { FlagScreen, RequireAuth } from "@/components/feature";
import { ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Row, Screen, T } from "@/components/ui";
import { useHostedPay } from "@/hooks/useHostedPay";
import { formatDayLong, formatMoney, formatTime } from "@/lib/format";
import { orderTone, pharmacyCancellable } from "@/lib/orders";
import { medName } from "@/lib/localName";

function Body({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const q = usePharmacyOrder(id);
  const cancel = useCancelPharmacyOrder();
  const { pay, busy } = useHostedPay(async () => (await q.refetch()).data, (o) => o.status !== "PENDING_PAYMENT");
  const [msg, setMsg] = useState<string | null>(null);
  const o = q.data;
  if (q.isLoading) return <LoadingState />;
  if (q.error || !o) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Screen testID="pharmacy-order" style={{ gap: 12 }}>
      <Card style={{ gap: 8 }}>
        <Row style={{ justifyContent: "space-between" }}><T variant="title" style={{ flex: 1 }} accessibilityRole="header">{t("pharmacy.orderTitle")}</T><Badge testID="order-status" tone={orderTone(o.status)} label={t(`pharmacy.status.${o.status}`)} /></Row>
        <T variant="small" muted>{formatDayLong(o.createdAt, lang)} · {formatTime(o.createdAt, lang)}</T>
        <Badge tone="muted" icon={o.deliveryMethod === "PICKUP" ? "pin" : "device"} label={t(o.deliveryMethod === "PICKUP" ? "pharmacy.pickup" : "pharmacy.deliveryHome")} />
      </Card>
      {msg ? <Banner tone="warning" body={msg} testID="order-message" /> : null}
      {o.status === "PENDING_PAYMENT" ? <Banner tone="warning" title={t("pharmacy.payTitle")} body={t("pharmacy.payBody")}><Button testID="pay-order" icon="card" loading={busy} title={t("pharmacy.payNow", { amount: formatMoney(o.totalMinor / 100, lang) })} onPress={() => void pay(o.payment?.checkoutUrl).then((r) => setMsg(r === "pending" ? t("pharmacy.payPending") : r === "failed" ? t("pharmacy.payFailed") : null))} /></Banner> : null}
      {o.status === "READY" ? <Banner tone="success" testID="order-ready" title={t("pharmacy.readyTitle")} body={o.readyAt ? t("pharmacy.readyBody", { time: formatTime(o.readyAt, lang) }) : undefined} /> : null}
      {o.status === "OUT_FOR_DELIVERY" ? <Banner tone="ink" testID="order-out-for-delivery" title={t("pharmacy.outForDeliveryTitle")} body={o.outForDeliveryAt ? t("pharmacy.outForDeliveryBody", { time: formatTime(o.outForDeliveryAt, lang) }) : t("pharmacy.outForDeliveryHint")} /> : null}
      {o.status === "PARTIAL_REVIEW" ? <Banner tone="warning" testID="order-partial" title={t("pharmacy.partialTitle")} body={t("pharmacy.partialBody")} /> : null}
      {o.status === "REJECTED" ? <Banner tone="danger" testID="order-rejected" title={t("pharmacy.rejectedTitle")} body={o.rejectionReason ?? t("pharmacy.rejectedBody")} /> : null}
      {o.rxStatus !== "NOT_REQUIRED" ? <Card style={{ gap: 4 }}><T variant="label">{t("pharmacy.rxStatus")}</T><Badge tone={o.rxStatus === "VALID" ? "success" : o.rxStatus === "INVALID" ? "danger" : "warning"} label={t(`pharmacy.rx.${o.rxStatus}`)} /></Card> : null}
      <Card style={{ gap: 8 }}>
        {o.items.map((i) => <Row key={i.sku} style={{ justifyContent: "space-between" }}><T style={{ flex: 1 }}>{medName(lang, i)} × {i.qty}</T><T>{formatMoney((i.unitPriceMinor * i.qty) / 100, lang)}</T></Row>)}
        <View style={{ height: 1, backgroundColor: "#8884" }} />
        <Row style={{ justifyContent: "space-between" }}><T variant="small" muted>{t("pharmacy.deliveryFee")}</T><T variant="small">{formatMoney(o.deliveryFeeMinor / 100, lang)}</T></Row>
        <Row style={{ justifyContent: "space-between" }}><T weight="bold">{t("pharmacy.total")}</T><T weight="bold">{formatMoney(o.totalMinor / 100, lang)}</T></Row>
      </Card>
      {o.refund ? (
        <Card style={{ gap: 8 }} testID="order-refund">
          <Row style={{ justifyContent: "space-between" }}><T variant="title" style={{ flex: 1 }} accessibilityRole="header">{t("pharmacy.refund.title")}</T><Badge tone={o.refund.status === "SETTLED" ? "success" : "ink"} label={t(`pharmacy.refund.status.${o.refund.status}`)} /></Row>
          <T variant="small" muted>{t("pharmacy.refund.intro")}</T>
          {o.refund.lines.filter((l) => l.qtyRefunded > 0).map((l) => <Row key={l.sku} style={{ justifyContent: "space-between" }} testID={`refund-line-${l.sku}`}><T style={{ flex: 1 }}>{medName(lang, l)} × {l.qtyRefunded} {t("pharmacy.refund.ofOrdered", { count: l.qtyOrdered })}</T><T>−{formatMoney(l.refundMinor / 100, lang)}</T></Row>)}
          {o.refund.deliveryFeeMinor > 0 ? <Row style={{ justifyContent: "space-between" }}><T style={{ flex: 1 }}>{t("pharmacy.refund.deliveryFee")}</T><T>−{formatMoney(o.refund.deliveryFeeMinor / 100, lang)}</T></Row> : null}
          <View style={{ height: 1, backgroundColor: "#8884" }} />
          <Row style={{ justifyContent: "space-between" }}><T weight="bold">{t("pharmacy.refund.total")}</T><T testID="refund-total" weight="bold">{formatMoney(o.refund.totalMinor / 100, lang)}</T></Row>
        </Card>
      ) : null}
      {pharmacyCancellable(o.status) ? <Button testID="cancel-order" variant="danger" loading={cancel.isPending} title={t("pharmacy.cancelOrder")} onPress={() => cancel.mutate(o.id, { onSuccess: () => setMsg(o.payment?.status === "CAPTURED" ? t("pharmacy.cancelledRefund") : t("pharmacy.cancelled")), onError: () => setMsg(t("pharmacy.cancelFailed")) })} /> : null}
    </Screen>
  );
}
export default function PharmacyOrder() { const { id = "" } = useLocalSearchParams<{ id: string }>(); return <RequireAuth><FlagScreen flag="kiorex.pharmacy_orders"><Body id={id} /></FlagScreen></RequireAuth>; }
