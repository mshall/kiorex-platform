import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useLabBookings } from "@/api/features";
import { FlagScreen, RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Card, Row, Screen, T } from "@/components/ui";
import { formatDay, formatMoney, formatTime } from "@/lib/format";
import { orderTone } from "@/lib/orders";

function Body() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const q = useLabBookings();
  return (
    <Screen testID="lab-bookings-list" style={{ gap: 10 }}>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState icon="flask" title={t("lab.noBookings")} hint={t("lab.noBookingsHint")} /> : q.data.map((b) => (
        <Card key={b.id} testID={`lbooking-${b.id}`} onPress={() => router.push(`/lab/booking/${b.id}`)} accessibilityLabel={b.tests.map((x) => x.name).join(", ")} style={{ gap: 6 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}><T weight="semibold">{b.tests.map((x) => x.name).join(" · ")}</T><T variant="small" muted>{formatDay(b.slotStartsAt, lang)} · {formatTime(b.slotStartsAt, lang)} · {formatMoney(b.totalMinor / 100, lang)}</T></View>
            <Badge tone={orderTone(b.status)} label={t(`lab.status.${b.status}`)} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
export default function LabBookings() { return <RequireAuth><FlagScreen flag="kiorex.lab_bookings"><Body /></FlagScreen></RequireAuth>; }
