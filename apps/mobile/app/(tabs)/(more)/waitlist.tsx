import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useAcceptOffer, useDeclineOffer, useLeaveWaitlist, useWaitlist } from "@/api/features";
import type { S } from "@/api/types";
import { FlagScreen, RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Row, Screen, T } from "@/components/ui";
import { formatDay, formatDayLong, formatTime, pick } from "@/lib/format";

type Entry = S["WaitlistEntryDto"];
const TONE = { WAITING: "ink", OFFERED: "warning", BOOKED: "success", CANCELLED: "muted", EXPIRED: "muted" } as const;

function EntryCard({ e, onMessage }: { e: Entry; onMessage: (m: string) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const accept = useAcceptOffer();
  const decline = useDeclineOffer();
  const leave = useLeaveWaitlist();
  const live = e.offers.filter((o) => o.status === "OFFERED" && new Date(o.expiresAt).getTime() > Date.now());
  const name = e.doctor ? pick(e.doctor, "name", lang) : "…"; // doctor summary ships with the entry: no per-entry profile fetch
  const onAccept = (offerId: string) => accept.mutate(offerId, {
    onSuccess: (b) => router.push(`/checkout/${b.id}`), // normal 5-minute hold → confirm
    onError: (err) => onMessage(err instanceof ApiError && err.status === 410 ? t("waitlist.offerExpired") : err instanceof ApiError && err.code === "SLOT_TAKEN" ? t("waitlist.slotTaken") : t("states.errorBody")),
  });
  return (
    <Card testID={`waitlist-${e.id}`} style={{ gap: 10 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}><T variant="h2" onPress={() => router.push(`/doctor/${e.providerId}`)}>{name}</T>
          <T variant="small" muted>{e.preferredFrom && e.preferredTo ? t("waitlist.preferred", { from: formatDay(e.preferredFrom, lang), to: formatDay(e.preferredTo, lang) }) : t("waitlist.anyTime")} · {t("waitlist.until", { date: formatDay(e.expiresAt, lang) })}</T></View>
        <Badge testID={`waitlist-status-${e.id}`} tone={TONE[e.status]} label={t(`waitlist.status.${e.status}`)} />
      </Row>
      {live.map((o) => (
        <Banner key={o.id} tone="warning" testID={`offer-${o.id}`} title={t("waitlist.offerTitle")} body={t("waitlist.offerBody", { day: formatDayLong(o.startsAt, lang), time: formatTime(o.startsAt, lang), until: formatTime(o.expiresAt, lang) })}>
          <Row gap={8}><Button testID={`accept-${o.id}`} small style={{ flex: 1 }} loading={accept.isPending} title={t("waitlist.accept")} onPress={() => onAccept(o.id)} />
            <Button testID={`decline-${o.id}`} small style={{ flex: 1 }} variant="secondary" loading={decline.isPending} title={t("waitlist.decline")} onPress={() => decline.mutate(o.id)} /></Row>
        </Banner>
      ))}
      {e.status === "BOOKED" ? <Button small variant="secondary" title={t("waitlist.viewAppointments")} onPress={() => router.push("/(tabs)/appointments")} /> : null}
      {(e.status === "WAITING" || e.status === "OFFERED") ? <Button testID={`leave-${e.id}`} small variant="ghost" icon="trash" loading={leave.isPending} title={t("waitlist.leave")} onPress={() => leave.mutate(e.id)} /> : null}
    </Card>
  );
}

function Body() {
  const { t } = useTranslation();
  const q = useWaitlist();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Screen testID="waitlist" style={{ gap: 12 }} refresh={undefined}>
      <T muted>{t("waitlist.intro")}</T>
      {msg ? <Banner tone="warning" body={msg} testID="waitlist-message" /> : null}
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? <EmptyState icon="clock" title={t("waitlist.empty")} hint={t("waitlist.emptyHint")} /> : q.data.map((e) => <EntryCard key={e.id} e={e} onMessage={setMsg} />)}
    </Screen>
  );
}
export default function WaitlistScreen() { return <RequireAuth><FlagScreen flag="kiorex.marketplace"><Body /></FlagScreen></RequireAuth>; }
