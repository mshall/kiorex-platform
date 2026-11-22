import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { usePublicVisitStatus, useStopVisitStatus } from "@/api/visitStatus";
import { ApiError } from "@/api/errors";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { VisitStepsTimeline } from "@/components/VisitStepsTimeline";
import { Icon } from "@/components/Icon";
import { Wordmark } from "@/components/Logo";
import { Badge, Banner, Button, Card, Row, Screen, T, useToast } from "@/components/ui";
import { formatDayLong, formatTime } from "@/lib/format";
import { isValidToken } from "@/lib/visitStatus";
import { useTheme } from "@/theme";

/** Public family link (no login): visit status only. Address, fee, phone and reason are never in the model, so they can never render. */
export default function VisitStatusScreen() {
  const { token: raw } = useLocalSearchParams<{ token: string }>();
  const token = Array.isArray(raw) ? raw[0] : raw;
  const valid = isValidToken(token);
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const toast = useToast();
  const lang = i18n.language;
  const q = usePublicVisitStatus(valid ? token : "", valid);
  const stop = useStopVisitStatus(valid ? token : "");
  const gone = !valid || (q.error instanceof ApiError && q.error.status === 404);
  const s = q.data;
  return (
    <Screen testID="visit-status" style={{ gap: 14 }}>
      <Stack.Screen options={{ title: t("hv.familyScreenTitle"), headerBackVisible: false }} />
      <View style={{ alignItems: "flex-start" }} accessibilityRole="header" accessibilityLabel="Kiorex"><Wordmark /></View>
      {gone ? <EmptyState icon="clock" title={t("hv.linkGoneTitle")} hint={t("hv.linkGoneBody")} />
        : q.isLoading ? <LoadingState />
        : q.error || !s ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : (
          <>
            <Card style={{ gap: 6 }} testID="family-hero">
              <T variant="title" accessibilityRole="header">{t("hv.familyTitle", { name: s.firstName })}</T>
              <T muted testID="family-when">{formatDayLong(s.startsAt, lang)} · {formatTime(s.startsAt, lang)}</T>
              {s.etaMinutes != null ? <Row gap={8} style={{ marginTop: 6 }}><Icon name="pin" size={18} color={colors.pulse} /><T weight="semibold" testID="family-eta" accessibilityRole="text" accessibilityLiveRegion="polite">{t("hv.eta", { minutes: s.etaMinutes })}</T></Row> : null}
            </Card>
            {s.stopped ? <Banner tone="ink" body={t("hv.familyStopped")} testID="family-stopped" /> : (
              <>
                {s.providerName ? <Card testID="family-provider"><Row gap={10}><Icon name="user" color={colors.ink} /><T style={{ flex: 1 }}>{t("hv.familyProvider", { name: s.providerName })}</T></Row></Card> : null}
                <Card style={{ gap: 10 }} testID="family-steps-card"><T variant="h2" accessibilityRole="header">{t("hv.progressTitle")}</T><VisitStepsTimeline steps={s.steps} /></Card>
                {stop.isSuccess ? <Badge tone="success" label={t("hv.familyStopDone")} testID="family-stop-done" /> : (
                  <Button testID="family-stop" variant="secondary" title={t("hv.familyStop")} accessibilityLabel={t("hv.familyStop")} loading={stop.isPending}
                    onPress={() => stop.mutate(undefined, { onSuccess: () => { toast.show(t("hv.familyStopDone")); void q.refetch(); }, onError: () => toast.show(t("states.errorTitle")) })} />
                )}
              </>
            )}
          </>
        )}
      <T variant="caption" muted testID="family-privacy">{t("hv.familyPrivacy")}</T>
    </Screen>
  );
}
