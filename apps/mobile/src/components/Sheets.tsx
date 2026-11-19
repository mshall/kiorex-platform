import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { SearchParams, Slot } from "@/api/types";
import { formatDay, formatTime } from "@/lib/format";
import { Button, Chip, Row, Sheet, Stack, T } from "./ui";

const FEES = [200, 400, 600];
const RATINGS = [3, 4, 4.5];

/** Filters sheet (KX-03 §06): fee, gender, rating, availability, deposit, sort. */
export function FiltersSheet({ visible, onClose, value, onApply }: { visible: boolean; onClose: () => void; value: SearchParams; onApply: (v: SearchParams) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<SearchParams>(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible, value]);
  const set = (p: Partial<SearchParams>) => setDraft((d) => ({ ...d, ...p }));
  const toggle = <K extends keyof SearchParams>(k: K, v: SearchParams[K]) => set({ [k]: draft[k] === v ? undefined : v } as Partial<SearchParams>);
  return (
    <Sheet visible={visible} onClose={onClose} title={t("results.filters")} testID="filters-sheet"
      footer={<Row gap={12}><Button style={{ flex: 1 }} variant="secondary" title={t("filters.reset")} onPress={() => onApply({ q: value.q, specialty: value.specialty })} /><Button testID="apply-filters" style={{ flex: 2 }} title={t("filters.apply")} onPress={() => onApply(draft)} /></Row>}>
      <Stack gap={8}><T variant="label">{t("results.sort")}</T>
        <Row style={{ flexWrap: "wrap" }}>{(["earliest", "distance", "rating", "fee"] as const).map((s) => <Chip key={s} label={t(`sort.${s}`)} selected={(draft.sort ?? "earliest") === s} onPress={() => set({ sort: s })} />)}</Row></Stack>
      <Stack gap={8}><T variant="label">{t("filters.maxFee")}</T>
        <Row style={{ flexWrap: "wrap" }}><Chip label={t("filters.anyFee")} selected={draft.maxFee === undefined} onPress={() => set({ maxFee: undefined })} />{FEES.map((f) => <Chip key={f} label={`≤ ${f}`} selected={draft.maxFee === f} onPress={() => toggle("maxFee", f)} />)}</Row></Stack>
      <Stack gap={8}><T variant="label">{t("filters.gender")}</T>
        <Row style={{ flexWrap: "wrap" }}><Chip label={t("filters.female")} selected={draft.gender === "F"} onPress={() => toggle("gender", "F")} /><Chip label={t("filters.male")} selected={draft.gender === "M"} onPress={() => toggle("gender", "M")} /></Row></Stack>
      <Stack gap={8}><T variant="label">{t("filters.rating")}</T>
        <Row style={{ flexWrap: "wrap" }}>{RATINGS.map((r) => <Chip key={r} label={`${r}+`} icon="star" selected={draft.minRating === r} onPress={() => toggle("minRating", r)} />)}</Row></Stack>
      <Stack gap={8}><T variant="label">{t("filters.availability")}</T>
        <Row style={{ flexWrap: "wrap" }}>{([[1, "today"], [3, "threeDays"], [7, "week"]] as const).map(([d, k]) => <Chip key={d} label={t(`filters.${k}`)} selected={draft.availableWithinDays === d} onPress={() => toggle("availableWithinDays", d)} />)}</Row></Stack>
      <Chip label={t("filters.acceptsDeposit")} selected={!!draft.acceptsDeposit} onPress={() => set({ acceptsDeposit: draft.acceptsDeposit ? undefined : true })} />
    </Sheet>
  );
}

/** 409 SLOT_TAKEN: offer the (up to 3) alternatives Kiorly returned (KXMBK04). */
export function SlotTakenSheet({ alternatives, onClose, onPick }: { alternatives: Slot[] | null; onClose: () => void; onPick: (s: Slot) => void }) {
  const { t, i18n } = useTranslation();
  return (
    <Sheet visible={alternatives !== null} onClose={onClose} title={t("booking.slotTakenTitle")} testID="slot-taken-sheet">
      <T muted>{alternatives?.length ? t("booking.slotTakenBody") : t("booking.slotTakenNone")}</T>
      <View style={{ gap: 8 }}>
        {(alternatives ?? []).map((s) => (
          <Chip key={s.startsAt} testID={`alt-${s.startsAt}`} label={`${formatDay(s.startsAt, i18n.language)} · ${formatTime(s.startsAt, i18n.language)}`} onPress={() => onPick(s)} />
        ))}
      </View>
    </Sheet>
  );
}
