import { useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button, Card, Field, Screen, Stack as VStack, T } from "@/components/ui";
import { claimCode } from "@/lib/deferred-link";
import { setGrowthConsent } from "@/lib/growthConsent";
import { clearPendingRef, sendPendingTouch } from "@/lib/linkRef";

/** iOS first-launch claim code (GRW-P1-H): the code shown on the web fallback page after consent. Typing it is the person's explicit act; Allow sends it, Not now discards it. */
export default function Claim() {
  const { t } = useTranslation();
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const home = () => router.replace("/(tabs)" as never);
  const submit = async (allow: boolean) => {
    if (!allow) { await clearPendingRef(); await setGrowthConsent("denied"); home(); return; }
    const ref = await claimCode(text);
    if (!ref) { setError(true); return; }
    await setGrowthConsent("granted"); await sendPendingTouch(); home();
  };
  return (
    <Screen testID="claim" title={t("deepLink.claimTitle")}>
      <VStack>
        <Card><T>{t("deepLink.claimBody")}</T><T color="#6B7280">{t("deepLink.draft")}</T></Card>
        <Field testID="claim-input" label={t("deepLink.claimLabel")} value={text} onChangeText={(v: string) => { setText(v); setError(false); }} autoCapitalize="characters" autoCorrect={false} maxLength={20} />
        {error ? <T color="#B91C1C">{t("deepLink.claimInvalid")}</T> : null}
        <Button testID="claim-allow" title={t("deepLink.allow")} onPress={() => void submit(true)} />
        <Button testID="claim-decline" variant="secondary" title={t("deepLink.decline")} onPress={() => void submit(false)} />
      </VStack>
    </Screen>
  );
}
