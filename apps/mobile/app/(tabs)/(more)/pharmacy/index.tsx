import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useCart, useMedicineSearch, usePharmacies, useSetCart } from "@/api/features";
import { FlagScreen, RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Chip, Field, Row, Screen, T } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { medForm, medName } from "@/lib/localName";

function Body() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const pharmacies = usePharmacies();
  const cart = useCart();
  const setCart = useSetCart();
  const [pharmacyId, setPharmacyId] = useState<string>();
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const activePharmacy = pharmacyId ?? cart.data?.pharmacyId ?? pharmacies.data?.[0]?.id;
  const search = useMedicineSearch(q, activePharmacy);
  const count = cart.data?.items.reduce((n, i) => n + i.qty, 0) ?? 0;

  const add = (sku: string, ph: string) => {
    setMsg(null);
    const same = cart.data?.pharmacyId === ph;
    const items = same ? [...cart.data!.items.map((i) => ({ sku: i.sku, qty: i.qty }))] : [];
    const ex = items.find((i) => i.sku === sku);
    if (ex) ex.qty += 1; else items.push({ sku, qty: 1 });
    setCart.mutate({ pharmacyId: ph, items }, { onError: (e) => setMsg(e instanceof ApiError && e.code ? t("pharmacy.addFailed") : t("states.errorBody")) });
  };

  return (
    <Screen testID="pharmacy" style={{ gap: 12 }} footer={count ? <Button testID="open-cart" icon="cart" title={t("pharmacy.viewCart", { count })} onPress={() => router.push("/pharmacy/cart")} /> : undefined}>
      <Row style={{ flexWrap: "wrap" }}><Button small variant="secondary" testID="pharmacy-orders" icon="list" title={t("pharmacy.myOrders")} onPress={() => router.push("/pharmacy/orders")} /></Row>
      <Banner tone="ink" body={t("pharmacy.controlledNote")} />
      {pharmacies.isLoading ? <LoadingState /> : pharmacies.error ? <ErrorState error={pharmacies.error} onRetry={() => void pharmacies.refetch()} /> : !pharmacies.data?.length ? <EmptyState icon="pill" title={t("pharmacy.noPharmacies")} hint={t("pharmacy.noPharmaciesHint")} /> : (
        <>
          <T variant="label">{t("pharmacy.choose")}</T>
          <Row style={{ flexWrap: "wrap" }}>{pharmacies.data.map((p) => <Chip key={p.id} testID={`ph-${p.id}`} label={p.name} selected={activePharmacy === p.id} onPress={() => setPharmacyId(p.id)} />)}</Row>
          {cart.data?.pharmacyId && activePharmacy && cart.data.pharmacyId !== activePharmacy && cart.data.items.length ? <Banner tone="warning" body={t("pharmacy.onePharmacy")} /> : null}
          <Field testID="medicine-search" label={t("pharmacy.search")} placeholder={t("pharmacy.searchPlaceholder")} value={q} onChangeText={setQ} returnKeyType="search" />
          {msg ? <Banner tone="danger" body={msg} testID="pharmacy-message" /> : null}
          {q.trim().length < 2 ? <T variant="small" muted>{t("pharmacy.searchHint")}</T> : search.isLoading ? <LoadingState /> : search.error ? <ErrorState error={search.error} onRetry={() => void search.refetch()} /> : !search.data?.items.length ? <EmptyState icon="pill" title={t("pharmacy.noResults")} hint={t("pharmacy.noResultsHint")} /> : search.data.items.map((m) => (
            <Card key={`${m.pharmacyId}-${m.sku}`} testID={`med-${m.sku}`} style={{ gap: 6 }}>
              <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}><T weight="semibold">{medName(lang, m)}</T><T variant="small" muted>{[m.strength, medForm(lang, m)].filter(Boolean).join(" · ")}</T></View>
                <T weight="bold">{formatMoney(m.priceMinor / 100, lang)}</T>
              </Row>
              <Row style={{ flexWrap: "wrap" }}>{m.rxRequired ? <Badge tone="warning" icon="file" label={t("pharmacy.rxRequired")} /> : null}{!m.available ? <Badge tone="danger" label={t("pharmacy.unavailable")} /> : null}</Row>
              <Button testID={`add-${m.sku}`} small disabled={!m.available} loading={setCart.isPending && setCart.variables?.items.some((i) => i.sku === m.sku)} icon="plus" title={t("pharmacy.addToCart")} onPress={() => add(m.sku, m.pharmacyId)} />
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
export default function PharmacyHome() { return <RequireAuth><FlagScreen flag="kiorex.pharmacy_orders"><Body /></FlagScreen></RequireAuth>; }
