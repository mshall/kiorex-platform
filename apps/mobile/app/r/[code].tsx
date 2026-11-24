import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button, Card, Screen, Stack as VStack, T } from "@/components/ui";
import { REF_CODE_RE, normalizeProviderCode } from "@/lib/deepLink";
import { setGrowthConsent } from "@/lib/growthConsent";
import { clearPendingRef, sendPendingTouch, setPendingRef } from "@/lib/linkRef";

/**
 * Referral / provider-link landing inside the app (GRW-P1-H). Consent first: the code is held on the device and only sent when the person presses
 * Allow; Not now discards it. Equal-weight buttons, no pre-selection. The wording is a draft (NEEDS_HUMAN: counsel approval, consent package GRW-P1-I).
 * An invalid code shows nothing about the input and just offers Home.
 */
export default function ReferralLanding() {
  const { code, k } = useLocalSearchParams<{ code: string; k?: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const provider = k === "p" ? normalizeProviderCode(code ?? "") : null;
  const ref = provider ? { kind: "provider" as const, code: provider } : typeof code === "string" && REF_CODE_RE.test(code) ? { kind: "referral" as const, code } : null;
  const home = () => router.replace("/(tabs)" as never);
  const choose = async (allow: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (allow && ref) { await setGrowthConsent("granted"); await setPendingRef(ref); await sendPendingTouch(); }
      else { await setGrowthConsent("denied"); await clearPendingRef(); }
    } finally { home(); }
  };
  if (!ref) return <Screen testID="ref-invalid"><VStack><T weight="semibold">{t("deepLink.invalidTitle")}</T><Button title={t("nav.home")} onPress={home} /></VStack></Screen>;
  return (
    <Screen testID="ref-landing" title={t("deepLink.title")}>
      <VStack>
        <Card><T>{t("deepLink.consent")}</T><T color="#6B7280">{t("deepLink.draft")}</T></Card>
        <Button testID="ref-allow" title={t("deepLink.allow")} onPress={() => void choose(true)} />
        <Button testID="ref-decline" variant="secondary" title={t("deepLink.decline")} onPress={() => void choose(false)} />
      </VStack>
    </Screen>
  );
}
