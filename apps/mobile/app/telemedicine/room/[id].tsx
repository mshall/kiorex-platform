import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useEndTele, useJoinTele, useTeleSession } from "@/api/features";
import type { S } from "@/api/types";
import { FlagScreen, RequireAuth } from "@/components/feature";
import { Icon, type IconName } from "@/components/Icon";
import { ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Row, Screen, T } from "@/components/ui";
import { formatCountdown, formatDayLong, formatTime } from "@/lib/format";
import { MIN_TOUCH, useTheme } from "@/theme";

function Ctl({ icon, label, on, onPress, danger, testID }: { icon: IconName; label: string; on?: boolean; onPress: () => void; danger?: boolean; testID: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on }} onPress={onPress}
      style={{ width: MIN_TOUCH + 12, height: MIN_TOUCH + 12, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: danger ? colors.danger : on ? colors.surface : "#FFFFFF22", borderWidth: 1, borderColor: "#FFFFFF44" }}>
      <Icon name={icon} color={danger ? colors.onDanger : on ? colors.ink : "#fff"} />
    </Pressable>
  );
}

/** MOCK video room (MESSAGING/video provider = mock): the API issues a fake token; no media is streamed. The screen exercises join window, token, in-call controls and end. */
function Room({ session, video, onEnd }: { session: S["TeleSessionDto"]; video: S["VideoTokenDto"]; onEnd: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [sec, setSec] = useState(0);
  useEffect(() => { const i = setInterval(() => setSec((s) => s + 1), 1000); return () => clearInterval(i); }, []);
  return (
    <View testID="video-room" style={{ gap: 12 }}>
      <View style={{ height: 280, borderRadius: 20, backgroundColor: "#0F1024", alignItems: "center", justifyContent: "center", gap: 8, overflow: "hidden" }} accessible accessibilityLabel={t("tele.remoteTile")}>
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" }}><Icon name="user" size={40} color="#fff" /></View>
        <T color="#E0E7FF">{t("tele.waitingDoctor")}</T>
        <View style={{ position: "absolute", top: 12, start: 12 }}><Badge tone="success" label={formatCountdown(sec * 1000)} /></View>
        <View style={{ position: "absolute", bottom: 12, end: 12, width: 84, height: 112, borderRadius: 12, backgroundColor: "#23245A", alignItems: "center", justifyContent: "center" }} accessible accessibilityLabel={t("tele.selfTile")}>
          <Icon name={cam ? "video" : "phoneOff"} color="#fff" />
        </View>
      </View>
      <Row gap={14} style={{ justifyContent: "center" }}>
        <Ctl testID="toggle-mic" icon="mic" label={mic ? t("tele.muteMic") : t("tele.unmuteMic")} on={mic} onPress={() => setMic((v) => !v)} />
        <Ctl testID="toggle-cam" icon="video" label={cam ? t("tele.camOff") : t("tele.camOn")} on={cam} onPress={() => setCam((v) => !v)} />
        <Ctl testID="end-call" icon="phoneOff" danger label={t("tele.end")} onPress={onEnd} />
      </Row>
      <Card style={{ gap: 4 }}>
        <T variant="label" muted>{t("tele.roomInfo")}</T>
        <T variant="caption" forceLatin style={{ writingDirection: "ltr", textAlign: "left" }} testID="video-room-id">{video.room} · {video.provider}</T>
        <T variant="caption" muted>{t("tele.tokenExpires", { time: formatTime(video.expiresAt, "en") })}</T>
      </Card>
      <T variant="caption" muted accessibilityRole="text">{t("tele.mockNote")}</T>
      <T variant="caption" muted>{session.id}</T>
    </View>
  );
}

function Body({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const router = useRouter();
  const q = useTeleSession(id);
  const join = useJoinTele();
  const end = useEndTele();
  const [video, setVideo] = useState<S["VideoTokenDto"] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const s = q.data;
  if (q.isLoading) return <LoadingState />;
  if (q.error || !s) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const opensIn = new Date(s.joinOpensAt).getTime() - now;
  const ended = s.status === "ENDED" || s.status === "CANCELLED";
  const onJoin = () => { setMsg(null); join.mutate(s.id, { onSuccess: (r) => setVideo(r.video), onError: (e) => setMsg(e instanceof ApiError && e.isFeatureDisabled ? t("unavailable.body") : e instanceof ApiError && e.status === 403 ? t("tele.tooEarly") : t("tele.joinFailed")) }); };
  const onEnd = () => end.mutate(s.id, { onSuccess: () => setVideo(null), onError: () => setMsg(t("tele.endFailed")) });
  return (
    <Screen testID="tele-room" style={{ gap: 12 }}>
      <Card style={{ gap: 6 }}>
        <Row style={{ justifyContent: "space-between" }}><T variant="h2" style={{ flex: 1 }} accessibilityRole="header">{formatDayLong(s.scheduledStartsAt, lang)} · {formatTime(s.scheduledStartsAt, lang)}</T><Badge testID="tele-status" tone={s.status === "IN_PROGRESS" ? "success" : s.status === "WAITING" ? "warning" : ended ? "muted" : "ink"} label={t(`tele.status.${s.status}`)} /></Row>
      </Card>
      {msg ? <Banner tone="warning" body={msg} testID="tele-message" /> : null}
      {video && !ended ? <Room session={s} video={video} onEnd={onEnd} /> : ended ? (
        <Banner tone="ink" testID="tele-ended" title={t("tele.endedTitle")} body={s.durationSec != null ? t("tele.endedBody", { min: Math.max(1, Math.round(s.durationSec / 60)) }) : undefined}><Button title={t("tele.back")} variant="secondary" onPress={() => router.replace("/(tabs)/appointments")} /></Banner>
      ) : (
        <Card style={{ gap: 10 }}>
          <T variant="h2">{t("tele.lobbyTitle")}</T>
          <T variant="small" muted>{opensIn > 0 ? t("tele.opensIn", { time: formatCountdown(opensIn) }) : t("tele.lobbyBody")}</T>
          <Button testID="join-room" icon="video" loading={join.isPending} disabled={opensIn > 0} title={t("tele.join")} onPress={onJoin} />
        </Card>
      )}
    </Screen>
  );
}
export default function TeleRoom() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  return <RequireAuth><FlagScreen flag="kiorex.telemedicine"><Stack.Screen options={{ title: "" }} /><Body id={id} /></FlagScreen></RequireAuth>;
}
