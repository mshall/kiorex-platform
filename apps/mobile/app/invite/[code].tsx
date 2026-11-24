import { useEffect, useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthProvider";
import { Button, Card, Screen, Stack as VStack, T } from "@/components/ui";
import { LoadingState } from "@/components/states";
import { normaliseInviteCode, useClaimInvite } from "@/modules/referral/api";

/**
 * Invite landing (deep link target for `/{locale}/{cc}/invite/<code>`, `/invite/<code>` and `kiorex://invite/<code>`). Neutral: "a friend invited you", nothing about who. The link never signs anyone in:
 * signed out shows the sign-up button (the code is re-resolved from the same link after sign-in, only the validated 8-character code is ever kept); signed in claims the code once. Every refusal reads the same.
 */
export default function InviteLanding() {
  const { code: raw } = useLocalSearchParams<{ code: string }>(); const code = normaliseInviteCode(raw);
  const { t } = useTranslation(); const router = useRouter(); const { status } = useAuth(); const claim = useClaimInvite(); const done = useRef(false);
  useEffect(() => { if (code && status === "signedIn" && !done.current) { done.current = true; claim.mutate(code); } }, [code, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const home = () => router.replace("/(tabs)" as never);
  const bad = !code || claim.isError || claim.data?.status === "REJECTED" || claim.data?.status === "EXPIRED";
  if (bad) return <Screen testID="invite-invalid"><VStack><T variant="h2" accessibilityRole="header">{t("referral.landing.invalidTitle")}</T><T muted>{t("referral.landing.invalidBody")}</T><Button title={t("referral.landing.browse")} onPress={home} /></VStack></Screen>;
  if (status === "loading" || claim.isPending) return <Screen testID="invite-checking"><LoadingState /></Screen>;
  if (status !== "signedIn") return (
    <Screen testID="invite-landing"><VStack>
      <Card style={{ gap: 8 }}><T variant="h2" accessibilityRole="header">{t("referral.landing.title")}</T><T muted>{t("referral.landing.body")}</T><T variant="caption" muted>{t("referral.landing.privacy")}</T></Card>
      <Button testID="invite-signup" title={t("referral.landing.signup")} onPress={() => router.push({ pathname: "/sign-in", params: { next: `/invite/${code}` } } as never)} />
    </VStack></Screen>
  );
  return (
    <Screen testID="invite-accepted"><VStack>
      <Card style={{ gap: 8 }}><T variant="h2" accessibilityRole="header">{t("referral.landing.acceptedTitle")}</T><T muted>{t("referral.landing.acceptedBody")}</T></Card>
      <Button testID="invite-find-doctor" title={t("referral.landing.findDoctor")} onPress={() => router.replace("/(tabs)" as never)} />
    </VStack></Screen>
  );
}
