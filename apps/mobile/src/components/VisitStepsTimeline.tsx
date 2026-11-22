import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { VisitStep } from "@/lib/visitStatus";
import { useTheme } from "@/theme";
import { Icon } from "./Icon";
import { T } from "./ui";

/** Family-link progress steps (reached / not yet). Direction-neutral: the row flips with RTL automatically. */
export function VisitStepsTimeline({ steps }: { steps: VisitStep[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const current = steps.reduce((c, s, i) => (s.reached ? i : c), -1);
  return (
    <View testID="family-steps" accessibilityLabel={t("hv.progressTitle")}>
      {steps.map((s, i) => {
        const label = t(`hv.step.${s.key}`, { defaultValue: s.key });
        const isCurrent = i === current;
        return (
          <View key={s.key} style={{ flexDirection: "row", gap: 12 }} accessible accessibilityLabel={`${label}, ${s.reached ? t("hv.stepDone") : t("hv.pending")}`} testID={`family-step-${s.key}`}>
            <View style={{ alignItems: "center", width: 24 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: isCurrent ? colors.pulse : s.reached ? colors.ink : colors.border, backgroundColor: s.reached && !isCurrent ? colors.ink : "transparent" }}>
                {isCurrent ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.pulse }} /> : s.reached ? <Icon name="check" size={14} color={colors.onInk} /> : null}
              </View>
              {i < steps.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: colors.border }} /> : null}
            </View>
            <View style={{ paddingBottom: 14, flex: 1 }}><T weight={s.reached ? "medium" : "regular"} muted={!s.reached}>{label}</T></View>
          </View>
        );
      })}
    </View>
  );
}
