import { Pressable, Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { MARKETING_CHANNELS, usePreferences, useUnsubscribeMarketing, useUpdatePreferences, type PreferencesUpdate } from "@/api/preferences";
import { ErrorState, LoadingState } from "@/components/states";
import { Icon } from "@/components/Icon";
import { Button, Card, Chip, Row, Screen, T, useToast } from "@/components/ui";
import { RequireAuth } from "@/components/feature";
import { setGrowthConsent } from "@/lib/growthConsent";
import { useTheme } from "@/theme";

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const wrap24 = (h: number) => ((h % 24) + 24) % 24;

/** One labelled switch; the label and the body are linked for screen readers, the hit area is 44 pt or more. */
function Choice({ id, title, body, value, onChange, disabled }: { id: string; title: string; body?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Row gap={12} style={{ justifyContent: "space-between", alignItems: "flex-start", minHeight: 44 }}>
      <View style={{ flex: 1, gap: 2 }}><T weight="semibold">{title}</T>{body ? <T variant="small" muted>{body}</T> : null}</View>
      <Switch testID={id} accessibilityLabel={title} value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: colors.ink, false: colors.borderStrong }} thumbColor={colors.surface} ios_backgroundColor={colors.borderStrong} />
    </Row>
  );
}

/** Hour stepper for the quiet window: 24 h clock, wraps around midnight, no free text. */
function HourStepper({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (h: number) => void }) {
  const { colors } = useTheme();
  const btn = { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: colors.borderStrong } as const;
  return (
    <View style={{ gap: 4 }}>
      <T variant="label" muted>{label}</T>
      <Row gap={8} style={{ alignItems: "center" }}>
        <Pressable testID={`${id}-dec`} accessibilityRole="button" accessibilityLabel={`${label} -1`} onPress={() => onChange(wrap24(value - 1))} style={btn}><T weight="semibold">−</T></Pressable>
        <T testID={`${id}-value`} weight="semibold" forceLatin style={{ minWidth: 56, textAlign: "center" }}>{hh(value)}</T>
        <Pressable testID={`${id}-inc`} accessibilityRole="button" accessibilityLabel={`${label} +1`} onPress={() => onChange(wrap24(value + 1))} style={btn}><T weight="semibold">+</T></Pressable>
      </Row>
    </View>
  );
}

function PreferencesBody() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const toast = useToast();
  const q = usePreferences();
  const update = useUpdatePreferences();
  const unsub = useUnsubscribeMarketing();
  const ok = () => toast.show(t("prefs.saved"));
  const fail = () => toast.show(t("prefs.error"), "error");
  const change = (b: PreferencesUpdate) => update.mutate(b, {
    onSuccess: () => {
      // the device-level measurement store follows the account choice, so nothing is sent from this device after a withdrawal
      if (b.analytics !== undefined) void setGrowthConsent(b.analytics ? "granted" : "denied");
      ok();
    },
    onError: fail,
  });
  return (
    <Screen testID="preferences" style={{ gap: 12 }}>
      <T variant="small" muted>{t("prefs.hint")}</T>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data ? (
        <>
          {q.data.draftWording && __DEV__ ? <Chip testID="prefs-draft" label={t("prefs.draft")} /> : null}
          <Card style={{ gap: 8 }} testID="prefs-service">
            <T variant="h2">{t("prefs.serviceTitle")}</T>
            <T variant="small" muted>{t("prefs.serviceBody")}</T>
            {q.data.serviceMessages.map((s) => (
              <Row key={s.purpose} style={{ justifyContent: "space-between", minHeight: 36 }}>
                <Row gap={8}><Icon name="lock" size={16} color={colors.muted} /><T>{t(`prefs.service.${s.purpose}`)}</T></Row>
                <T variant="caption" weight="semibold" color={colors.success}>{t("prefs.required")}</T>
              </Row>
            ))}
          </Card>
          <Card style={{ gap: 10 }} testID="prefs-classes">
            <T variant="h2">{t("prefs.classesTitle")}</T>
            <T variant="small" muted>{t("prefs.classesBody")}</T>
            {(["TRANSACTIONAL", "SECURITY", "CLINICAL", "MARKETING"] as const).map((c) => (
              <View key={c} testID={`prefs-class-${c}`} style={{ gap: 2 }} accessible accessibilityLabel={`${t(`prefs.classes.${c}.name`)}. ${c === "MARKETING" ? t("prefs.classOptional") : t("prefs.classRequired")}. ${t(`prefs.classes.${c}.body`)}`}>
                <Row gap={8} style={{ justifyContent: "space-between" }}><T weight="semibold">{t(`prefs.classes.${c}.name`)}</T><T variant="caption" weight="semibold" color={c === "MARKETING" ? colors.muted : colors.success}>{c === "MARKETING" ? t("prefs.classOptional") : t("prefs.classRequired")}</T></Row>
                <T variant="small" muted>{t(`prefs.classes.${c}.body`)}</T>
              </View>
            ))}
          </Card>
          <Card style={{ gap: 14 }}>
            <Choice id="pref-reminders" title={t("prefs.remindersTitle")} body={t("prefs.remindersBody")} value={q.data.reminders.consent} disabled={update.isPending} onChange={(v) => change({ reminders: v })} />
            <Choice id="pref-analytics" title={t("prefs.analyticsTitle")} body={t("prefs.analyticsBody")} value={q.data.analytics.consent} disabled={update.isPending} onChange={(v) => change({ analytics: v })} />
          </Card>
          <Card style={{ gap: 10 }} testID="prefs-marketing">
            <T variant="h2">{t("prefs.marketingTitle")}</T>
            <T variant="small" muted>{t("prefs.marketingBody")}</T>
            {!q.data.marketing.available ? <T variant="small" muted testID="prefs-marketing-inactive">{t("prefs.marketingNotActive")}</T> : null}
            {MARKETING_CHANNELS.map((ch) => {
              const row = q.data!.marketing.channels.find((c) => c.channel === ch);
              return <Choice key={ch} id={`pref-marketing-${ch}`} title={t(`prefs.channel.${ch}`)} body={row?.suppressed ? t("prefs.suppressed") : undefined} value={row?.marketingConsent ?? false} disabled={update.isPending} onChange={(v) => change({ marketing: { [ch]: v } })} />;
            })}
            <T variant="caption" muted>{t("prefs.capsNote", { day: q.data.caps.perDay, week: q.data.caps.perWeek })}</T>
            <Button testID="pref-unsubscribe" variant="secondary" title={t("prefs.unsubscribe")} disabled={!q.data.marketing.anyConsent || unsub.isPending} onPress={() => unsub.mutate(undefined, { onSuccess: () => toast.show(t("prefs.unsubscribed")), onError: fail })} />
          </Card>
          <Card style={{ gap: 10 }} testID="prefs-quiet">
            <T variant="h2">{t("prefs.quietTitle")}</T>
            <T variant="small" muted>{t("prefs.quietBody")}</T>
            <T variant="caption" muted>{t("prefs.quietDefault", { start: hh(q.data.quietHours.defaultStart), end: hh(q.data.quietHours.defaultEnd), zone: q.data.quietHours.timezone })}</T>
            <Row gap={24} style={{ flexWrap: "wrap" }}>
              {(["start", "end"] as const).map((k) => {
                const cur = q.data!.quietHours[k] ?? (k === "start" ? q.data!.quietHours.defaultStart : q.data!.quietHours.defaultEnd);
                const other = (k === "start" ? q.data!.quietHours.end ?? q.data!.quietHours.defaultEnd : q.data!.quietHours.start ?? q.data!.quietHours.defaultStart);
                return <HourStepper key={k} id={`pref-quiet-${k}`} label={t(k === "start" ? "prefs.quietFrom" : "prefs.quietTo")} value={cur} onChange={(h) => change({ quietHours: k === "start" ? { start: h, end: other } : { start: other, end: h } })} />;
              })}
            </Row>
            {q.data.quietHours.start !== null ? <Button testID="pref-quiet-reset" variant="secondary" title={t("prefs.quietReset")} onPress={() => change({ quietHours: null })} /> : null}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

export default function Preferences() { return <RequireAuth><PreferencesBody /></RequireAuth>; }
