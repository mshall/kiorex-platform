import type { ReactNode } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type ViewProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle, type RefreshControlProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { fontFamily, MIN_TOUCH, radius, useTheme, type Weight } from "@/theme";
import { Icon, type IconName } from "./Icon";

// ---- Text ----
type Variant = "display" | "title" | "h2" | "body" | "small" | "caption" | "label";
const SIZES: Record<Variant, { size: number; weight: Weight; line: number }> = {
  display: { size: 30, weight: "bold", line: 38 }, title: { size: 24, weight: "semibold", line: 32 }, h2: { size: 18, weight: "semibold", line: 26 },
  body: { size: 16, weight: "regular", line: 24 }, small: { size: 14, weight: "regular", line: 20 }, caption: { size: 12, weight: "regular", line: 16 }, label: { size: 14, weight: "medium", line: 20 },
};
export function T({ variant = "body", weight, muted, color, forceLatin, style, ...p }: TextProps & { variant?: Variant; weight?: Weight; muted?: boolean; color?: string; forceLatin?: boolean }) {
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  const v = SIZES[variant];
  return <Text {...p} style={[{ fontSize: v.size, lineHeight: v.line, color: color ?? (muted ? colors.muted : colors.text), fontFamily: fontFamily(forceLatin ? "en" : i18n.language, weight ?? v.weight) }, style]} />;
}

// ---- Layout ----
export function Screen({ children, scroll = true, padded = true, refresh, footer, style, testID }: {
  children: ReactNode; scroll?: boolean; padded?: boolean; refresh?: React.ReactElement<RefreshControlProps>; footer?: ReactNode; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView refreshControl={refresh} keyboardShouldPersistTaps="handled" contentContainerStyle={[padded && { padding: 16 }, { paddingBottom: 24 }, style]} showsVerticalScrollIndicator={false}>{children}</ScrollView>
  ) : <View style={[{ flex: 1 }, padded && { padding: 16 }, style]}>{children}</View>;
  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: colors.ground }}>
      {body}
      {footer ? <View style={{ padding: 16, paddingBottom: 16 + (insets.bottom ? 0 : 0), backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>{footer}</View> : null}
    </View>
  );
}

export function Card({ children, style, onPress, accessibilityLabel, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string; testID?: string }) {
  const { colors } = useTheme();
  const base: ViewStyle = { backgroundColor: colors.surface, borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 16 };
  if (onPress) return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }, style]}>{children}</Pressable>;
  return <View testID={testID} style={[base, style]}>{children}</View>;
}

export const Row = ({ children, style, gap = 8, ...rest }: ViewProps & { gap?: number }) => <View {...rest} style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
export const Stack = ({ children, gap = 12, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) => <View style={[{ gap }, style]}>{children}</View>;
export const Divider = () => { const { colors } = useTheme(); return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 }} />; };

// ---- Button ----
type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ title, onPress, variant = "primary", disabled, loading, icon, style, testID, accessibilityLabel, small }: {
  title: string; onPress?: () => void; variant?: BtnVariant; disabled?: boolean; loading?: boolean; icon?: IconName; style?: StyleProp<ViewStyle>; testID?: string; accessibilityLabel?: string; small?: boolean;
}) {
  const { colors } = useTheme();
  const bg = variant === "primary" ? colors.ink : variant === "danger" ? colors.danger : variant === "secondary" ? colors.surface : "transparent";
  const fg = variant === "primary" ? colors.onInk : variant === "danger" ? colors.onDanger : colors.ink;
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off} onPress={onPress}
      style={({ pressed }) => [{
        minHeight: small ? MIN_TOUCH : 50, borderRadius: radius, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8,
        backgroundColor: bg, borderWidth: variant === "secondary" ? 1.5 : 0, borderColor: colors.ink, opacity: off ? 0.5 : pressed ? 0.85 : 1,
      }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={20} color={fg} /> : null}
      <T variant="label" weight="semibold" style={{ color: fg, fontSize: 16 }}>{title}</T>
    </Pressable>
  );
}

// ---- Chip / Badge ----
export function Chip({ label, selected, onPress, testID, icon }: { label: string; selected?: boolean; onPress?: () => void; testID?: string; icon?: IconName }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected }}
      style={{ minHeight: MIN_TOUCH, paddingHorizontal: 16, borderRadius: 999, justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 6, backgroundColor: selected ? colors.ink : colors.surface, borderWidth: 1, borderColor: selected ? colors.ink : colors.border }}>
      {icon ? <Icon name={icon} size={16} color={selected ? colors.onInk : colors.ink} /> : null}
      <T variant="small" weight="medium" color={selected ? colors.onInk : colors.text}>{label}</T>
    </Pressable>
  );
}

export function Badge({ label, tone = "ink", icon, testID }: { testID?: string; label: string; tone?: "ink" | "ocean" | "success" | "warning" | "danger" | "muted"; icon?: IconName }) {
  const { colors } = useTheme();
  const map = { ink: [colors.soft, colors.ink], ocean: [colors.soft, colors.ink2], success: [colors.successSoft, colors.success], warning: [colors.warningSoft, colors.warning], danger: [colors.dangerSoft, colors.danger], muted: [colors.ground, colors.muted] }[tone];
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: map[0], borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      {icon ? <Icon name={icon} size={14} color={map[1]} /> : null}
      <T variant="caption" weight="semibold" color={map[1]}>{label}</T>
    </View>
  );
}

// ---- Inputs ----
export function Field({ label, style, ...p }: TextInputProps & { label?: string }) {
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  return (
    <View style={{ gap: 6 }}>
      {label ? <T variant="label">{label}</T> : null}
      <TextInput
        accessibilityLabel={label ?? p.placeholder} placeholderTextColor={colors.muted}
        style={[{ minHeight: 50, borderRadius: radius, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 14, fontSize: 16, fontFamily: fontFamily(i18n.language, "regular"), textAlign: i18n.language.startsWith("ar") ? "right" : "left" }, style]}
        {...p}
      />
    </View>
  );
}

export function Checkbox({ checked, onChange, label, testID }: { checked: boolean; onChange: (v: boolean) => void; label: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} onPress={() => onChange(!checked)} style={{ minHeight: MIN_TOUCH, flexDirection: "row", gap: 12, alignItems: "flex-start", paddingVertical: 6 }}>
      <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: checked ? colors.ink : colors.muted, backgroundColor: checked ? colors.ink : "transparent", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
        {checked ? <Icon name="check" size={16} color={colors.onInk} /> : null}
      </View>
      <T variant="small" style={{ flex: 1 }}>{label}</T>
    </Pressable>
  );
}

// ---- Feedback ----
export function Banner({ tone = "warning", title, body, children, testID }: { tone?: "warning" | "danger" | "success" | "ink"; title?: string; body?: string; children?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const [bg, fg] = { warning: [colors.warningSoft, colors.warning], danger: [colors.dangerSoft, colors.danger], success: [colors.successSoft, colors.success], ink: [colors.soft, colors.ink] }[tone];
  return (
    <View testID={testID} accessibilityRole="alert" style={{ backgroundColor: bg, borderRadius: radius, padding: 14, gap: 6, borderWidth: 1, borderColor: fg }}>
      {title ? <T variant="label" weight="bold" color={fg}>{title}</T> : null}
      {body ? <T variant="small" color={colors.text}>{body}</T> : null}
      {children}
    </View>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { colors } = useTheme();
  return <View style={{ padding: 32, alignItems: "center", gap: 10 }} accessibilityRole="progressbar" accessibilityLabel={label}><ActivityIndicator size="large" color={colors.ink} />{label ? <T variant="small" muted>{label}</T> : null}</View>;
}

// ---- Bottom sheet ----
export function Sheet({ visible, onClose, title, children, footer, testID }: { visible: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} accessibilityViewIsModal>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t("common.close")} />
        <View testID={testID} style={{ maxHeight: "88%", backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: insets.bottom + 8 }}>
          <Row style={{ padding: 16, justifyContent: "space-between" }}>
            <T variant="h2" style={{ flex: 1 }} accessibilityRole="header">{title}</T>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} style={{ width: MIN_TOUCH, height: MIN_TOUCH, alignItems: "center", justifyContent: "center" }}><Icon name="close" color={colors.text} /></Pressable>
          </Row>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer ? <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export const textStyle = (s: TextStyle) => s;
