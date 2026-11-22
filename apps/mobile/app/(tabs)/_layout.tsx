import { StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";
import { Icon } from "@/components/Icon";
import { fontFamily, useTheme } from "@/theme";
import { haptic } from "@/lib/haptics";

export default function TabsLayout() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  return (
    <Tabs backBehavior="history" screenListeners={{ tabPress: () => haptic.select() }} screenOptions={{
      headerShown: false, tabBarActiveTintColor: colors.ink, tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, minHeight: 62, paddingTop: 4, elevation: 0 },
      tabBarLabelStyle: { fontFamily: fontFamily(i18n.language, "medium"), fontSize: 12 }, tabBarItemStyle: { minHeight: 48 },
    }}>
      <Tabs.Screen name="index" options={{ title: t("tabs.home"), tabBarButtonTestID: "tab-home", tabBarIcon: ({ color }) => <Icon name="home" color={color as string} /> }} />
      <Tabs.Screen name="appointments" options={{ title: t("tabs.appointments"), tabBarButtonTestID: "tab-appointments", tabBarIcon: ({ color }) => <Icon name="calendar" color={color as string} /> }} />
      <Tabs.Screen name="records" options={{ title: t("tabs.records"), tabBarButtonTestID: "tab-records", tabBarIcon: ({ color }) => <Icon name="file" color={color as string} /> }} />
      <Tabs.Screen name="account" options={{ title: t("tabs.account"), tabBarButtonTestID: "tab-account", tabBarIcon: ({ color }) => <Icon name="user" color={color as string} /> }} />
      {/* `href: null` hidden tabs are not navigable in expo-router 58 (they redirect), so keep the tab mounted and just hide its button */}
      <Tabs.Screen name="(more)" options={{ title: "", tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
    </Tabs>
  );
}
