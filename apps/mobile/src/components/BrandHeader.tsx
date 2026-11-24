import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { layout, useTheme } from "@/theme";
import { Lockup } from "@/components/Logo";
import { LanguageMenu } from "@/components/LanguageMenu";

/** Quiet brand bar: the Kiorex lockup (mark | coral rule | KIOREX) on the leading edge, controls on the trailing edge, on the plain screen surface (no banner, no gradient).
 *  Respects the top safe area; 56 pt tall below it. `bordered` adds a hairline underneath. */
export function BrandHeader({ children, bordered = false, testID = "brand-header" }: { children?: ReactNode; bordered?: boolean; testID?: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID} style={{ paddingTop: insets.top, paddingHorizontal: layout.gutter + 4, borderBottomWidth: bordered ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
      <View style={{ height: layout.headerH, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View testID="brand-lockup" accessible accessibilityRole="header" accessibilityLabel="Kiorex" style={{ flexShrink: 1 }}><Lockup height={44} /></View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>{children}</View>
      </View>
    </View>
  );
}

/** Tab screen frame: the brand bar (lockup left, language menu right) pinned above the screen content. */
export function TabFrame({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <BrandHeader><LanguageMenu testID="language-menu" /></BrandHeader>
      {children}
    </View>
  );
}
