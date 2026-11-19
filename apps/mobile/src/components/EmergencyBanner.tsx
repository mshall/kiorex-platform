import { Linking, View } from "react-native";
import { useTranslation } from "react-i18next";
import { EMERGENCY_NUMBER } from "@/lib/emergency";
import { useTheme } from "@/theme";
import { Button, T } from "./ui";
import { Icon } from "./Icon";

/** Emergency guidance (KX-16 H07). Shown instead of results; booking is never offered for emergency terms.
 *  NEEDS_HUMAN: clinical wording requires CMO approval (KX-16) — copy mirrors the web app. */
export function EmergencyBanner({ onCall = (n: string) => Linking.openURL(`tel:${n}`) }: { onCall?: (n: string) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View testID="emergency-banner" accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: 2, borderRadius: 14, padding: 16, gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <Icon name="alert" color={colors.danger} size={26} />
        <T variant="h2" color={colors.danger} style={{ flex: 1 }} accessibilityRole="header">{t("emergency.title")}</T>
      </View>
      <T>{t("emergency.body")}</T>
      <Button testID="call-emergency" variant="danger" icon="phone" title={t("emergency.call", { number: EMERGENCY_NUMBER })} onPress={() => onCall(EMERGENCY_NUMBER)} />
      <T variant="caption" muted>{t("emergency.note")}</T>
    </View>
  );
}
