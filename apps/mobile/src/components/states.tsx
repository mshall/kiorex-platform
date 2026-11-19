import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useTheme } from "@/theme";
import { Button, Spinner, T } from "./ui";
import { Icon, type IconName } from "./Icon";

export const LoadingState = () => { const { t } = useTranslation(); return <Spinner label={t("states.loading")} />; };

export function EmptyState({ icon = "search", title, hint, action }: { icon?: IconName; title: string; hint?: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", padding: 28, gap: 10 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={28} color={colors.ink} /></View>
      <T variant="h2" style={{ textAlign: "center" }}>{title}</T>
      {hint ? <T muted style={{ textAlign: "center" }}>{hint}</T> : null}
      {action}
    </View>
  );
}

/** Flag OFF ⇒ "temporarily unavailable" in AR/EN (never hides data; existing appointments stay reachable). */
export function UnavailableState({ featureKey }: { featureKey?: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View testID="unavailable" accessibilityRole="alert" style={{ alignItems: "center", padding: 28, gap: 10 }} accessibilityLabel={featureKey}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.warningSoft, alignItems: "center", justifyContent: "center" }}><Icon name="clock" size={28} color={colors.warning} /></View>
      <T variant="h2" style={{ textAlign: "center" }}>{t("unavailable.title")}</T>
      <T muted style={{ textAlign: "center" }}>{t("unavailable.body")}</T>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  if (error instanceof ApiError && error.isFeatureDisabled) return <UnavailableState featureKey={error.featureKey} />;
  return (
    <View testID="error-state" style={{ alignItems: "center", padding: 28, gap: 10 }}>
      <T variant="h2" style={{ textAlign: "center" }}>{t("states.errorTitle")}</T>
      <T muted style={{ textAlign: "center" }}>{t("states.errorBody")}</T>
      {onRetry ? <Button title={t("states.retry")} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}
