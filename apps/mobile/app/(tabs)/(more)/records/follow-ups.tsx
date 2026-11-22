import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAddFollowUp, useFollowUps, useRemoveFollowUp } from "@/api/features";
import { RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Chip, Field, Row, Screen, T } from "@/components/ui";
import { formatDayLong } from "@/lib/format";

const PRESETS = [7, 14, 30, 90];
function Body() {
  const { t, i18n } = useTranslation();
  const q = useFollowUps();
  const add = useAddFollowUp();
  const remove = useRemoveFollowUp();
  const [days, setDays] = useState(14);
  const [custom, setCustom] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const n = custom.trim() ? Number(custom) : days;
  const valid = Number.isInteger(n) && n >= 1 && n <= 730;
  return (
    <Screen testID="follow-ups" style={{ gap: 12 }}>
      <Card style={{ gap: 10 }}>
        <T variant="h2" accessibilityRole="header">{t("followUps.addTitle")}</T>
        <T variant="small" muted>{t("followUps.addHint")}</T>
        <Row style={{ flexWrap: "wrap" }}>{PRESETS.map((d) => <Chip key={d} testID={`fu-${d}`} label={t("records.afterDays", { count: d })} selected={!custom && days === d} onPress={() => { setCustom(""); setDays(d); }} />)}</Row>
        <Field testID="fu-custom" label={t("followUps.custom")} keyboardType="number-pad" value={custom} onChangeText={(v) => setCustom(v.replace(/\D/g, "").slice(0, 3))} />
        <Button testID="fu-add" icon="bell" disabled={!valid} loading={add.isPending} title={t("followUps.add")} onPress={() => { setMsg(null); add.mutate({ afterDays: n }, { onSuccess: () => { setCustom(""); setMsg(t("records.reminderSet", { count: n })); }, onError: () => setMsg(t("records.reminderFailed")) }); }} />
      </Card>
      {msg ? <Banner tone="ink" body={msg} testID="fu-message" /> : null}
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState icon="bell" title={t("followUps.empty")} hint={t("followUps.emptyHint")} /> : q.data.map((f) => (
        <Card key={f.id} testID={`followup-${f.id}`} style={{ gap: 6 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1, gap: 2 }}><T weight="semibold">{formatDayLong(f.dueAt, i18n.language)}</T>
              <Row style={{ flexWrap: "wrap" }}><Badge tone={f.status === "DUE" ? "warning" : f.status === "CANCELLED" ? "muted" : "ink"} label={t(`followUps.status.${f.status}`)} /><Badge tone="muted" label={t(`followUps.source.${f.source}`)} /></Row></View>
            {f.status !== "CANCELLED" ? <Button small variant="ghost" icon="trash" title={t("followUps.remove")} onPress={() => remove.mutate(f.id)} /> : null}
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
export default function FollowUps() { return <RequireAuth><Body /></RequireAuth>; }
