import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAddAddress, useAddresses, useConfirmAddress, useHomeDistricts, useUpdateAddress } from "@/api/homecare";
import type { Address, CareTypeInfo, CareType } from "@/api/types";
import { Badge, Banner, Button, Card, Checkbox, Chip, Field, Row, Sheet, T } from "./ui";
import { Icon, type IconName } from "./Icon";
import { LoadingState } from "./states";
import { addressDraftValid, badgeText, CARE_TYPE_KEY, classifyHomeError, currentHomeStep, defaultAddress, districtLabel, draftFromAddress, draftToBody, emptyAddressDraft, etaMinutes, maskedAddressLine, type AddressDraft, type HomeView } from "@/lib/homecare";
import { formatDay, formatNumber, formatTime } from "@/lib/format";
import { useTheme } from "@/theme";

const CARE_ICON: Record<CareType, IconName> = { DOCTORS: "user", PHYSIOTHERAPY: "users", HOME_NURSING: "home" };

/** Care-type categories (KXMDS01). A category that is OFF / awaiting its launch gate stays visible and opens the awaiting-gate state. */
export function CareTypeTiles({ items, selected, onSelect, testIDPrefix = "care" }: { items: CareTypeInfo[]; selected?: CareType; onSelect: (c: CareTypeInfo) => void; testIDPrefix?: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {items.map((c) => {
        const on = selected === c.code;
        return (
          <Pressable key={c.code} testID={`${testIDPrefix}-${c.code}`} accessibilityRole="button" accessibilityState={{ selected: on, disabled: false }}
            accessibilityLabel={c.enabled ? t(`careType.${CARE_TYPE_KEY[c.code]}`) : `${t(`careType.${CARE_TYPE_KEY[c.code]}`)}. ${t("careType.awaitingShort")}`} onPress={() => onSelect(c)}
            style={{ flexBasis: "30%", flexGrow: 1, minHeight: 84, padding: 10, gap: 6, borderRadius: 14, backgroundColor: on ? colors.ink : colors.surface, borderWidth: 1, borderColor: on ? colors.ink : colors.border, opacity: c.enabled ? 1 : 0.75 }}>
            <Icon name={CARE_ICON[c.code]} color={on ? colors.onInk : c.enabled ? colors.ink : colors.muted} />
            <T variant="small" weight="semibold" color={on ? colors.onInk : colors.text}>{t(`careType.${CARE_TYPE_KEY[c.code]}`)}</T>
            {!c.enabled ? <T variant="caption" color={on ? colors.onInk : colors.warning}>{t("careType.awaitingShort")}</T> : <T variant="caption" color={on ? colors.onInk : colors.muted}>{i18n.language ? t("careType.providers", { count: c.providerCount }) : ""}</T>}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Add / edit sheet for one address-book entry. The doorstep lines are only ever loaded for the owner, here. */
export function AddressSheet({ visible, address, onClose, onSaved }: { visible: boolean; address?: Address; onClose: () => void; onSaved?: (a?: Address) => void }) {
  const { t, i18n } = useTranslation();
  const add = useAddAddress();
  const update = useUpdateAddress();
  const districts = useHomeDistricts(visible);
  const [d, setD] = useState<AddressDraft>(emptyAddressDraft());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (visible) { setD(address ? draftFromAddress(address) : emptyAddressDraft()); setErr(null); } }, [visible, address]);
  const set = (k: keyof AddressDraft) => (v: string | boolean) => setD((x) => ({ ...x, [k]: v }));
  const busy = add.isPending || update.isPending;
  const fail = (e: unknown) => {
    const c = classifyHomeError(e);
    setErr(c.kind === "address_limit" ? t("address.limit") : c.kind === "invalid_district" ? t("address.invalidDistrict") : c.kind === "feature_disabled" ? t("unavailable.body") : t("address.saveFailed"));
  };
  const save = () => {
    const body = draftToBody(d);
    if (address) update.mutate({ id: address.id, body }, { onSuccess: () => { onSaved?.(); onClose(); }, onError: fail });
    else add.mutate(body, { onSuccess: (a) => { onSaved?.(a as Address); onClose(); }, onError: fail });
  };
  const list = districts.data ?? [];
  return (
    <Sheet visible={visible} onClose={onClose} title={address ? t("address.edit") : t("address.add")} testID="address-sheet"
      footer={<Button testID="save-address" disabled={!addressDraftValid(d)} loading={busy} title={t("common.save")} onPress={save} />}>
      <Field testID="addr-label" label={t("address.label")} value={d.label} onChangeText={set("label")} placeholder={t("address.labelHint")} maxLength={40} />
      <Field testID="addr-governorate" label={t("address.governorate")} value={d.governorate} onChangeText={set("governorate")} maxLength={60} />
      <T variant="label">{t("address.district")}</T>
      {districts.isLoading ? <LoadingState /> : list.length ? (
        <Row style={{ flexWrap: "wrap" }}>{list.map((x) => (
          <Chip key={x.district} testID={`district-${x.district}`} label={districtLabel(x.district, i18n.language)} selected={d.district === x.district} onPress={() => setD((v) => ({ ...v, district: x.district, governorate: v.governorate || x.governorate || "" }))} />
        ))}</Row>
      ) : null}
      <Field testID="addr-district" value={d.district} onChangeText={set("district")} placeholder="nasr-city" autoCapitalize="none" style={{ writingDirection: "ltr" }} maxLength={40} />
      <T variant="caption" muted>{t("address.districtHint")}</T>
      <Field testID="addr-street" label={t("address.street")} value={d.street} onChangeText={set("street")} maxLength={200} />
      <Row gap={8}>
        <View style={{ flex: 1 }}><Field testID="addr-building" label={t("address.building")} value={d.building} onChangeText={set("building")} maxLength={20} /></View>
        <View style={{ flex: 1 }}><Field testID="addr-floor" label={t("address.floor")} value={d.floor} onChangeText={set("floor")} maxLength={20} /></View>
        <View style={{ flex: 1 }}><Field testID="addr-flat" label={t("address.flat")} value={d.flat} onChangeText={set("flat")} maxLength={20} /></View>
      </Row>
      <Field testID="addr-landmark" label={t("address.landmark")} value={d.landmark} onChangeText={set("landmark")} maxLength={120} />
      <Checkbox testID="addr-default" checked={d.makeDefault} onChange={(v) => set("makeDefault")(v)} label={t("address.makeDefault")} />
      <T variant="caption" muted>{t("address.privacy")}</T>
      {address ? <T variant="caption" muted>{t("address.editResets")}</T> : null}
      {err ? <Banner tone="danger" body={err} testID="address-error" /> : null}
    </Sheet>
  );
}

/** Confirms an address with the OTP-verified phone (required once before the first home booking). */
export function ConfirmAddressButton({ address, onDone }: { address: Address; onDone?: () => void }) {
  const { t } = useTranslation();
  const confirm = useConfirmAddress();
  const [msg, setMsg] = useState<string | null>(null);
  if (address.confirmed) return null;
  return (
    <View style={{ gap: 6 }}>
      <Button testID={`confirm-address-${address.id}`} small variant="secondary" icon="shield" loading={confirm.isPending} title={t("address.confirm")}
        onPress={() => { setMsg(null); confirm.mutate(address.id, { onSuccess: () => onDone?.(), onError: (e) => { const k = classifyHomeError(e).kind; setMsg(k === "phone_not_verified" ? t("address.phoneNotVerified") : k === "phone_mismatch" ? t("address.phoneMismatch") : t("address.confirmFailed")); } }); }} />
      {msg ? <T variant="caption" color="#B91C1C" accessibilityRole="alert">{msg}</T> : null}
    </View>
  );
}

/** Pick one saved address (masked: label + district only). Adds an entry inline when the book is empty. */
export function AddressPicker({ value, onChange, districtFilter, testID = "address-picker" }: { value?: string; onChange: (a: Address | undefined) => void; districtFilter?: readonly string[]; testID?: string }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const q = useAddresses();
  const [sheet, setSheet] = useState(false);
  const list = q.data ?? [];
  useEffect(() => { if (!value && list.length) onChange(defaultAddress(list)); }, [value, list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isLoading) return <LoadingState />;
  return (
    <View testID={testID} style={{ gap: 8 }}>
      {!list.length ? <T variant="small" muted>{t("address.emptyHint")}</T> : list.map((a) => {
        const on = a.id === value;
        const outside = !!districtFilter?.length && !districtFilter.includes(a.district);
        return (
          <Pressable key={a.id} testID={`pick-address-${a.id}`} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={maskedAddressLine(a, i18n.language)} onPress={() => onChange(a)}
            style={{ minHeight: 52, padding: 12, borderRadius: 12, borderWidth: on ? 2 : 1, borderColor: on ? colors.ink : colors.border, backgroundColor: colors.surface, gap: 4 }}>
            <Row gap={8}><Icon name="pin" size={18} color={on ? colors.ink : colors.muted} /><T weight="medium" style={{ flex: 1 }}>{maskedAddressLine(a, i18n.language)}</T>{a.isDefault ? <Badge tone="muted" label={t("address.default")} /> : null}</Row>
            <Row gap={6} style={{ flexWrap: "wrap" }}>
              <Badge tone={a.confirmed ? "success" : "warning"} label={a.confirmed ? t("address.confirmed") : t("address.unconfirmed")} />
              {outside ? <Badge tone="danger" label={t("address.outsideCoverage")} /> : null}
            </Row>
          </Pressable>
        );
      })}
      <Button testID="add-address" small variant="secondary" icon="plus" title={t("address.add")} onPress={() => setSheet(true)} />
      <AddressSheet visible={sheet} onClose={() => setSheet(false)} onSaved={(a) => { if (a) onChange(a); }} />
    </View>
  );
}

/** 422 OUT_OF_COVERAGE: explains it, lists the covered districts and in-zone alternatives (never an address). */
export function OutOfCoverage({ error, onPickProvider }: { error: unknown; onPickProvider?: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const c = classifyHomeError(error);
  return (
    <Banner tone="warning" testID="out-of-coverage" title={t("hv.outOfCoverageTitle")} body={t("hv.outOfCoverageBody", { district: districtLabel(c.district, i18n.language) || "—" })}>
      {c.coverage.length ? <T variant="small">{t("hv.coveredDistricts")}: {c.coverage.map((d) => districtLabel(d, i18n.language)).join(", ")}</T> : null}
      {c.suggested.length ? <View style={{ gap: 6 }}><T variant="label">{t("hv.suggested")}</T>{c.suggested.map((s) => (
        <Button key={s.id} small variant="secondary" testID={`suggested-${s.id}`} title={(i18n.language.startsWith("ar") ? s.nameAr ?? s.nameEn : s.nameEn ?? s.nameAr) ?? s.id} onPress={() => onPickProvider?.(s.id)} />
      ))}</View> : null}
    </Banner>
  );
}

/** Home visit timeline: Confirmed → (assigned) → On the way → Arrived → Finished, with ETA when the provider shares it, or the aborted-unsafe stop. */
export function HomeTimeline({ home }: { home: HomeView }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const cur = currentHomeStep(home);
  const eta = etaMinutes(home);
  const steps = (home.steps ?? []).filter((s) => !(home.aborted && s.key !== "CONFIRMED" && !s.reached));
  const showEnRoute = home.trackingEnabled !== false;
  const list = steps.filter((s) => (s.key === "ON_THE_WAY" ? showEnRoute || s.reached : true));
  return (
    <View testID="home-timeline" style={{ gap: 8 }}>
      {home.assignmentPending ? <Banner tone="ink" testID="assignment-pending" body={t("hv.assignmentPending")} /> : null}
      {home.aborted ? (
        <Banner tone="danger" testID="aborted-unsafe" title={t("hv.abortedTitle")}>
          <T variant="small">{t("hv.abortedBody")}</T>
          {home.aborted.depositUnderReview ? <T variant="small" weight="medium">{t("hv.abortedDeposit")}</T> : null}
        </Banner>
      ) : null}
      {list.map((s, i) => {
        const current = s.key === (cur === "ASSIGNED" ? "CONFIRMED" : cur);
        return (
          <View key={s.key} testID={`home-step-${s.key}`} accessible accessibilityLabel={`${t(`hv.step.${s.key}`)}${s.reached ? "" : `, ${t("hv.pending")}`}`} style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ alignItems: "center", width: 24 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: s.reached ? (current && !home.aborted ? colors.pulse : colors.ink) : colors.border, backgroundColor: s.reached && !(current && !home.aborted) ? colors.ink : "transparent" }}>
                {s.reached ? (current && !home.aborted ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.pulse }} /> : <Icon name="check" size={14} color={colors.onInk} />) : null}
              </View>
              {i < list.length - 1 ? <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: colors.border }} /> : null}
            </View>
            <View style={{ paddingBottom: 12, flex: 1 }}>
              <T weight="medium" color={s.reached ? undefined : colors.muted}>{t(`hv.step.${s.key}`)}</T>
              {s.at ? <T variant="caption" muted>{formatDay(s.at, i18n.language)} · {formatTime(s.at, i18n.language)}</T> : null}
              {s.key === "ON_THE_WAY" && cur === "ON_THE_WAY" && eta != null ? <T variant="small" testID="home-eta" color={colors.ink}>{t("hv.eta", { minutes: formatNumber(eta, i18n.language, 0) })}</T> : null}
            </View>
          </View>
        );
      })}
      {home.assignee?.displayName ? (
        <Card testID="home-assignee" style={{ gap: 2 }}>
          <T variant="caption" muted>{t("hv.assignedClinician")}</T>
          <T weight="semibold">{home.assignee.displayName}</T>
          {badgeText(home.assignee.badge, i18n.language) ? <Badge tone="success" icon="shield" label={badgeText(home.assignee.badge, i18n.language)} /> : null}
        </Card>
      ) : null}
    </View>
  );
}

export function GoSettingsLink({ label, href }: { label: string; href: string }) {
  const router = useRouter();
  return <Button small variant="ghost" title={label} onPress={() => router.push(href as never)} />;
}
