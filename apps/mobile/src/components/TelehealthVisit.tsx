import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useCountdown } from "@/hooks/useCountdown";
import { canJoin, telehealthPhase, type Telehealth } from "@/lib/telehealth";
import { formatCountdown, formatDay, formatTime } from "@/lib/format";
import { Badge, Banner, Button, Card, T } from "@/components/ui";

/** Clinic-owned video visit card: state, countdown to the join window, "Join video visit" (opens the Clinic page in an in-app WebView). */
export function TelehealthVisit({ bookingId, telehealth: tv }: { bookingId: string; telehealth: Telehealth }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const opens = useCountdown(tv.state === "SCHEDULED" ? tv.opensAt : null);
  const phase = telehealthPhase(tv);
  const before = phase === "beforeWindow" && !opens.expired;
  const joinable = canJoin(phase) || (phase === "beforeWindow" && opens.expired);
  const note: Partial<Record<typeof phase, string>> = { inPerson: t("tele.visit.inPerson"), cancelled: t("tele.visit.cancelled"), ended: t("tele.visit.ended"), missed: t("tele.visit.missed"), windowPassed: t("tele.visit.windowPassed"), noLink: t("tele.visit.noLink") };
  const showJoin = phase === "beforeWindow" || phase === "open" || phase === "live";
  return (
    <Card testID="telehealth-visit" style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <T variant="h2" style={{ flex: 1 }} accessibilityRole="header">{t("tele.visit.title")}</T>
        <Badge testID="telehealth-phase" tone={phase === "live" ? "success" : phase === "missed" || phase === "windowPassed" ? "warning" : phase === "open" || before ? "ocean" : "muted"} label={t(`tele.visit.phase.${phase}`)} />
      </View>
      {tv.movedFrom ? <T variant="small" muted testID="telehealth-moved">{t("tele.visit.moved", { time: `${formatDay(tv.movedFrom, lang)} ${formatTime(tv.movedFrom, lang)}` })}</T> : null}
      {note[phase] ? <Banner tone={phase === "inPerson" ? "ink" : phase === "missed" || phase === "windowPassed" ? "warning" : "ink"} testID="telehealth-note" body={note[phase]} /> : null}
      {before ? <View accessibilityLiveRegion="polite" testID="telehealth-countdown"><T variant="small" muted>{t("tele.visit.opensIn")}</T><T variant="title">{formatCountdown(opens.remainingMs ?? 0)}</T><T variant="caption" muted>{t("tele.visit.opensAt", { time: `${formatDay(tv.opensAt, lang)} ${formatTime(tv.opensAt, lang)}` })}</T></View> : null}
      {phase === "live" ? <T variant="small">{t("tele.visit.live")}</T> : phase === "open" ? <T variant="small">{t("tele.visit.opensNow")}</T> : null}
      {showJoin ? <Button testID="join-video-visit" icon="video" disabled={!joinable} title={t("tele.visit.join")} onPress={() => router.push(`/telemedicine/join/${bookingId}`)} /> : null}
      {showJoin ? <T variant="caption" muted>{t("tele.visit.closes", { time: `${formatDay(tv.closesAt, lang)} ${formatTime(tv.closesAt, lang)}` })} {t("tele.visit.hint")}</T> : null}
    </Card>
  );
}
