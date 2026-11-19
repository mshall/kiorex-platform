import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { DoctorSummary, Slot } from "@/api/types";
import { formatDay, formatMoney, formatNumber, formatTime, pick } from "@/lib/format";
import { useTheme } from "@/theme";
import { Icon } from "./Icon";
import { Badge, Card, Chip, Row, T } from "./ui";

export function VerifiedBadge() {
  const { t } = useTranslation();
  return <Badge tone="success" icon="shield" label={t("doctor.verified")} />;
}

export function Stars({ value, size = 14 }: { value: number | null; size?: number }) {
  const { colors } = useTheme();
  const v = Math.round(value ?? 0);
  return (
    <View style={{ flexDirection: "row", gap: 1 }} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={size} color={i <= v ? colors.pulse : colors.border} fill={i <= v ? colors.pulse : "none"} />)}
    </View>
  );
}

export function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  const initial = name.replace(/^(د\.|Dr\.?)\s*/i, "").trim().charAt(0) || "K";
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" }}>
      <T weight="bold" color={colors.ink} style={{ fontSize: size * 0.4 }}>{initial}</T>
    </View>
  );
}

export function SlotButton({ slot, selected, onPress, showDay }: { slot: Slot; selected?: boolean; onPress: () => void; showDay?: boolean }) {
  const { i18n } = useTranslation();
  const label = `${showDay ? `${formatDay(slot.startsAt, i18n.language)} · ` : ""}${formatTime(slot.startsAt, i18n.language)}`;
  return <Chip testID={`slot-${slot.startsAt}`} label={label} selected={selected} onPress={onPress} />;
}

export function DoctorCard({ d, onOpen, onPickSlot }: { d: DoctorSummary; onOpen: () => void; onPickSlot: (s: Slot) => void }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const lang = i18n.language;
  const name = pick(d, "name", lang);
  return (
    <Card testID={`doctor-${d.id}`} style={{ gap: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={onOpen} style={{ gap: 10 }}>
        <Row gap={12} style={{ alignItems: "flex-start" }}>
          <Avatar name={name} />
          <View style={{ flex: 1, gap: 4 }}>
            <T variant="h2">{name}</T>
            <T variant="small" muted>{[pick(d, "clinicName", lang), pick(d, "area", lang)].filter(Boolean).join(" · ")}</T>
            <Row gap={8} style={{ flexWrap: "wrap" }}>
              {d.verified ? <VerifiedBadge /> : null}
              {d.ratingAvg ? <Row gap={4}><Stars value={d.ratingAvg} /><T variant="caption" muted accessibilityLabel={t("doctor.ratingLabel", { avg: d.ratingAvg, count: d.ratingCount })}>{formatNumber(d.ratingAvg, lang)} ({d.ratingCount})</T></Row> : null}
            </Row>
          </View>
        </Row>
        <Row gap={12} style={{ flexWrap: "wrap" }}>
          <T variant="small" weight="semibold">{t("doctor.feeFrom", { fee: formatMoney(d.feeFromEgp, lang) })}</T>
          {d.distanceKm != null ? <Row gap={4}><Icon name="pin" size={14} color={colors.muted} /><T variant="small" muted>{t("doctor.distance", { km: formatNumber(d.distanceKm, lang) })}</T></Row> : null}
          {d.depositRequired ? <Badge tone="warning" label={t("doctor.depositRequired")} /> : null}
        </Row>
      </Pressable>
      <View style={{ gap: 6 }}>
        <T variant="caption" muted>{t("results.nextSlots")}</T>
        {d.nextSlots.length && d.bookable ? (
          <Row gap={8} style={{ flexWrap: "wrap" }}>{d.nextSlots.slice(0, 3).map((s) => <SlotButton key={s.startsAt} slot={s} showDay onPress={() => onPickSlot(s)} />)}</Row>
        ) : <T variant="small" muted>{t("results.noSlots")}</T>}
      </View>
    </Card>
  );
}
