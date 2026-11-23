import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useCart, useClearCart, usePlaceOrder, usePrescriptions, useSetCart, useSetDelivery } from "@/api/features";
import { FlagScreen, RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Chip, Field, Row, Screen, T } from "@/components/ui";
import { AddressPicker } from "@/components/homecare";
import { addressToBody } from "@/lib/homecare";
import type { Address } from "@/api/types";
import { useHostedPay } from "@/hooks/useHostedPay";
import { formatDay, formatMoney } from "@/lib/format";
import { medName } from "@/lib/localName";

function Body() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const cart = useCart();
  const setCart = useSetCart();
  const clear = useClearCart();
  const delivery = useSetDelivery();
  const place = usePlaceOrder();
  const c = cart.data;
  const rxs = usePrescriptions(!!c?.rxRequired);
  const [rxId, setRxId] = useState<string>();
  const [method, setMethod] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [addr, setAddr] = useState<Address | undefined>();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (c?.deliveryMethod) setMethod(c.deliveryMethod); }, [c?.deliveryMethod]);
  const { pay, busy } = useHostedPay();

  const changeQty = (sku: string, d: number) => {
    if (!c?.pharmacyId) return;
    const items = c.items.map((i) => ({ sku: i.sku, qty: i.sku === sku ? i.qty + d : i.qty })).filter((i) => i.qty > 0);
    if (!items.length) clear.mutate(); else setCart.mutate({ pharmacyId: c.pharmacyId, items, prescriptionRecordId: c.prescriptionRecordId ?? undefined });
  };
  const needsAddr = method === "DELIVERY";
  const addrOk = !needsAddr || (!!addr && !!addr.street);
  const needsRx = !!c?.rxRequired;
  const ready = !!c?.items.length && addrOk && (!needsRx || !!rxId) && c.items.every((i) => i.available);

  const checkout = async () => {
    setMsg(null);
    try {
      await delivery.mutateAsync(method === "PICKUP" ? { method } : { method, address: addressToBody(addr!) });
      const order = await place.mutateAsync({ prescriptionRecordId: rxId });
      // Hosted (mock PSP) checkout, then the order detail polls until the pharmacy acknowledges.
      await pay(order.payment?.checkoutUrl);
      router.replace(`/pharmacy/order/${order.id}`);
    } catch (e) {
      setMsg(e instanceof ApiError ? (e.isFeatureDisabled ? t("unavailable.body") : e.code === "PRESCRIPTION_REQUIRED" ? t("pharmacy.rxNeeded") : t("pharmacy.orderFailed")) : t("pharmacy.orderFailed"));
    }
  };

  if (cart.isLoading) return <LoadingState />;
  if (cart.error) return <ErrorState error={cart.error} onRetry={() => void cart.refetch()} />;
  if (!c?.items.length) return <EmptyState icon="cart" title={t("pharmacy.cartEmpty")} hint={t("pharmacy.cartEmptyHint")} action={<Button title={t("pharmacy.browse")} onPress={() => router.replace("/pharmacy")} />} />;
  return (
    <Screen testID="pharmacy-cart" style={{ gap: 12 }} footer={
      <View style={{ gap: 8 }}>
        <Row style={{ justifyContent: "space-between" }}><T weight="bold">{t("pharmacy.total")}</T><T testID="cart-total" weight="bold">{formatMoney(c.totalMinor / 100, lang)}</T></Row>
        <Button testID="place-order" icon="card" disabled={!ready} loading={place.isPending || delivery.isPending || busy} title={t("pharmacy.payAndOrder")} onPress={() => void checkout()} />
      </View>}>
      {msg ? <Banner tone="danger" body={msg} testID="cart-message" /> : null}
      {c.items.map((i) => (
        <Card key={i.sku} style={{ gap: 6 }} testID={`cart-line-${i.sku}`}>
          <Row style={{ justifyContent: "space-between" }}><View style={{ flex: 1 }}><T weight="semibold">{medName(lang, i)}</T><T variant="small" muted>{formatMoney(i.unitPriceMinor / 100, lang)}</T></View>
            <Row gap={4}><Button small variant="secondary" accessibilityLabel={t("pharmacy.less")} title="−" onPress={() => changeQty(i.sku, -1)} /><T weight="bold" style={{ minWidth: 24, textAlign: "center" }}>{i.qty}</T><Button small variant="secondary" accessibilityLabel={t("pharmacy.more")} title="+" onPress={() => changeQty(i.sku, 1)} /></Row></Row>
          <Row style={{ flexWrap: "wrap" }}>{i.rxRequired ? <Badge tone="warning" icon="file" label={t("pharmacy.rxRequired")} /> : null}{!i.available ? <Badge tone="danger" label={t("pharmacy.unavailable")} /> : null}</Row>
        </Card>
      ))}
      {needsRx ? (
        <Card style={{ gap: 8 }} testID="rx-picker">
          <T variant="h2">{t("pharmacy.pickRx")}</T><T variant="small" muted>{t("pharmacy.pickRxHint")}</T>
          {rxs.isLoading ? <LoadingState /> : !rxs.data?.length ? <Banner tone="warning" body={t("pharmacy.noRx")} /> : <Row style={{ flexWrap: "wrap" }}>{rxs.data.map((r) => <Chip key={r.id} testID={`rx-${r.id}`} icon="pill" label={`${r.title ?? t("records.kind.PRESCRIPTION")} · ${formatDay(r.signedAt ?? r.createdAt, lang)}`} selected={rxId === r.id} onPress={() => setRxId(r.id)} />)}</Row>}
        </Card>
      ) : null}
      <Card style={{ gap: 8 }}>
        <T variant="h2">{t("pharmacy.delivery")}</T>
        <Row style={{ flexWrap: "wrap" }}><Chip testID="method-PICKUP" label={t("pharmacy.pickup")} selected={method === "PICKUP"} onPress={() => setMethod("PICKUP")} /><Chip testID="method-DELIVERY" label={t("pharmacy.deliveryHome")} selected={method === "DELIVERY"} onPress={() => setMethod("DELIVERY")} /></Row>
        {needsAddr ? (<View style={{ gap: 8 }}><T variant="label">{t("pharmacy.deliverTo")}</T><AddressPicker value={addr?.id} onChange={setAddr} /></View>) : null}
        <Row style={{ justifyContent: "space-between" }}><T variant="small" muted>{t("pharmacy.subtotal")}</T><T variant="small">{formatMoney(c.subtotalMinor / 100, lang)}</T></Row>
        <Row style={{ justifyContent: "space-between" }}><T variant="small" muted>{t("pharmacy.deliveryFee")}</T><T variant="small">{formatMoney(c.deliveryFeeMinor / 100, lang)}</T></Row>
      </Card>
    </Screen>
  );
}
export default function PharmacyCart() { return <RequireAuth><FlagScreen flag="kiorex.pharmacy_orders"><Body /></FlagScreen></RequireAuth>; }
