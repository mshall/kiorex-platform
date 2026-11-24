import { Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { fontFamily, useTheme } from "@/theme";
import { Icon } from "@/components/Icon";

/** Every pushed screen (appointment, care-plans, doctor, lab, pharmacy, records/*, results, review, safety, settings/*, telemedicine list, waitlist, family-share, services) lives here,
 *  inside the `(tabs)` group as ONE hidden tab (button hidden), so the bottom tab bar stays visible. Route groups do not change URLs. Checkout (payment) and the telemedicine call
 *  stay full-screen on the root Stack on purpose and have their own back button. */
export default function MoreLayout() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never));
  const common = { headerStyle: { backgroundColor: colors.surface }, headerShadowVisible: false, animation: "slide_from_right" as const, headerLargeTitleShadowVisible: false, headerTintColor: colors.ink, headerTitleStyle: { fontFamily: fontFamily(i18n.language, "semibold"), color: colors.text }, contentStyle: { backgroundColor: colors.ground },
    // always a back button, even when a deep link / push opened the screen with no history (falls back to Home)
    headerBackVisible: false,
    headerLeft: () => (
      <Pressable onPress={back} testID="header-back" accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={8} style={{ width: 44, height: 44, justifyContent: "center", alignItems: "center" }}>
        <Icon name="back" color={colors.ink} mirror />
      </Pressable>
    ) };
  return (
    <Stack screenOptions={common}>
      <Stack.Screen name="services" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("services.title") }} />
      <Stack.Screen name="results" options={{ title: t("results.title") }} />
      <Stack.Screen name="doctor/[id]" options={{ title: "" }} />
      <Stack.Screen name="appointment/[id]" options={{ title: t("appointment.title") }} />
      <Stack.Screen name="review/[id]" options={{ title: t("review.submit") }} />
      <Stack.Screen name="settings/family" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("account.familyTitle") }} />
      <Stack.Screen name="settings/consents" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("account.consentsTitle") }} />
      <Stack.Screen name="settings/preferences" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("account.prefsTitle") }} />
      <Stack.Screen name="settings/sessions" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("account.sessionsTitle") }} />
      <Stack.Screen name="settings/delete" options={{ title: t("account.deleteTitle") }} />
      <Stack.Screen name="settings/addresses" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("address.title") }} />
      <Stack.Screen name="care-plans/index" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("carePlan.title") }} />
      <Stack.Screen name="safety/[id]" options={{ title: t("safety.title") }} />
      <Stack.Screen name="family-share/[id]" options={{ title: t("share.title") }} />
      <Stack.Screen name="waitlist" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("waitlist.title") }} />
      <Stack.Screen name="referral/index" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("referral.title") }} />
      <Stack.Screen name="corporate/index" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("corporate.title") }} />
      <Stack.Screen name="referral/rewards" options={{ title: t("referral.rewardsTitle") }} />
      <Stack.Screen name="records/[id]" options={{ title: t("records.title") }} />
      <Stack.Screen name="records/sharing" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("records.sharing") }} />
      <Stack.Screen name="records/follow-ups" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("records.followUps") }} />
      <Stack.Screen name="pharmacy/index" options={{ title: t("services.pharmacy") }} />
      <Stack.Screen name="pharmacy/cart" options={{ title: t("pharmacy.cart") }} />
      <Stack.Screen name="pharmacy/orders" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("pharmacy.myOrders") }} />
      <Stack.Screen name="pharmacy/order/[id]" options={{ title: t("pharmacy.orderTitle") }} />
      <Stack.Screen name="lab/index" options={{ title: t("services.lab") }} />
      <Stack.Screen name="lab/bookings" options={{ headerLargeTitle: true, headerLargeStyle: { backgroundColor: colors.ground }, title: t("lab.myBookings") }} />
      <Stack.Screen name="lab/booking/[id]" options={{ title: t("lab.bookingTitle") }} />
      <Stack.Screen name="telemedicine/index" options={{ title: t("services.telemedicine") }} />
    </Stack>
  );
}
