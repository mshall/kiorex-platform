import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Booking } from "@/api/types";
import { formatDay, formatTime } from "@/lib/format";
import { useTheme } from "@/theme";
import { Icon } from "./Icon";
import { T } from "./ui";

/** Status timeline per the KX-03 §05 state machine; only reached states are listed. */
export function StatusTimeline({ booking }: { booking: Pick<Booking, "timeline"> }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const events = booking.timeline.filter((e) => e.status !== "INTENT");
  const last = events[events.length - 1];
  return (
    <View testID="status-timeline" accessibilityLabel={t("appointment.timeline")} style={{ gap: 0 }}>
      {events.map((e, i) => {
        const current = e === last;
        return (
          <View key={`${e.status}-${i}`} style={{ flexDirection: "row", gap: 12 }} accessible accessibilityLabel={`${t(`status.${e.status}`)}, ${formatDay(e.at, i18n.language)} ${formatTime(e.at, i18n.language)}`}>
            <View style={{ alignItems: "center", width: 24 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: current ? colors.pulse : colors.ink, backgroundColor: current ? "transparent" : colors.ink }}>
                {current ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.pulse }} /> : <Icon name="check" size={14} color={colors.onInk} />}
              </View>
              {i < events.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: colors.border }} /> : null}
            </View>
            <View style={{ paddingBottom: 14, flex: 1 }}>
              <T weight="medium">{t(`status.${e.status}`)}</T>
              <T variant="caption" muted>{formatDay(e.at, i18n.language)} · {formatTime(e.at, i18n.language)}</T>
            </View>
          </View>
        );
      })}
    </View>
  );
}
