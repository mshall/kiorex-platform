import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { usePharmacyOrders } from "@/api/features";
import { FlagScreen, RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Card, Row, Screen, T } from "@/components/ui";
import { formatDay, formatMoney } from "@/lib/format";
import { orderTone } from "@/lib/orders";

function Body() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const q = usePharmacyOrders();
  return (
    <Screen testID="pharmacy-orders-list" style={{ gap: 10 }}>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState icon="pill" title={t("pharmacy.noOrders")} hint={t("pharmacy.noOrdersHint")} /> : q.data.map((o) => (
        <Card key={o.id} testID={`porder-${o.id}`} onPress={() => router.push(`/pharmacy/order/${o.id}`)} accessibilityLabel={t("pharmacy.orderOn", { date: formatDay(o.createdAt, i18n.language) })} style={{ gap: 6 }}>
          <Row style={{ justifyContent: "space-between" }}><View style={{ flex: 1 }}><T weight="semibold">{t("pharmacy.orderOn", { date: formatDay(o.createdAt, i18n.language) })}</T><T variant="small" muted>{t("pharmacy.itemsCount", { count: o.items.length })} · {formatMoney(o.totalMinor / 100, i18n.language)}</T></View>
            <Badge tone={orderTone(o.status)} label={t(`pharmacy.status.${o.status}`)} /></Row>
        </Card>
      ))}
    </Screen>
  );
}
export default function PharmacyOrders() { return <RequireAuth><FlagScreen flag="kiorex.pharmacy_orders"><Body /></FlagScreen></RequireAuth>; }
