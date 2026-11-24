import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Badge, Button, Card, Row, Screen, T } from "@/components/ui";
import { formatDay, formatMoney } from "@/lib/format";
import { useReferralRewards, useRevealCoupon, type RewardLine, type RewardStatus } from "@/modules/referral/api";

const TONE: Record<RewardStatus, "success" | "warning" | "muted" | "danger"> = { ACTIVE: "success", HELD: "warning", EXHAUSTED: "muted", EXPIRED: "muted", REVERSED: "danger" };

function Line({ r }: { r: RewardLine }) {
  const { t, i18n } = useTranslation(); const lang = i18n.language;
  const reveal = useRevealCoupon(); const [code, setCode] = useState<string | null>(null); const [failed, setFailed] = useState(false);
  const shown = r.status === "ACTIVE" ? r.remainingMinor ?? r.amountMinor : r.amountMinor;
  return (
    <Card testID={`reward-${r.id}`} style={{ gap: 6 }}>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}><T weight="semibold">{t(`referral.kind.${r.kind}`, r.kind)} · {t(r.mode === "COUPON" ? "referral.voucher" : "referral.credit")}</T><T variant="small" muted>{r.status === "ACTIVE" ? t("referral.expiresOn", { date: formatDay(r.expiresAt, lang) }) : t("referral.endedOn", { date: formatDay(r.expiresAt, lang) })}</T></View>
        <View style={{ alignItems: "flex-end", gap: 4 }}><T variant="h2">{formatMoney(shown / 100, lang)}</T><Badge testID={`reward-status-${r.id}`} tone={TONE[r.status]} label={t(`referral.status.${r.status}`)} /></View>
      </Row>
      {r.mode === "COUPON" && r.status === "ACTIVE" ? (code ? <Card testID={`coupon-${r.id}`} style={{ gap: 4, alignItems: "center" }}><T variant="h2" forceLatin style={{ letterSpacing: 3 }} selectable>{code}</T><T variant="caption" muted>{t("referral.codeOnce")}</T></Card>
        : r.couponState === "UNREVEALED" ? <View style={{ gap: 4 }}><Button testID={`reveal-${r.id}`} small variant="secondary" loading={reveal.isPending} title={t("referral.reveal")} onPress={() => reveal.mutate(r.id, { onSuccess: (x) => setCode(x.code), onError: () => setFailed(true) })} /><T variant="caption" muted>{failed ? t("referral.revealFailed") : t("referral.revealHint")}</T></View>
        : r.couponState === "REVEALED" ? <T testID={`revealed-${r.id}`} variant="caption" muted>{t("referral.alreadyShown")}</T> : null) : null}
    </Card>
  );
}

function Body() {
  const { t } = useTranslation(); const q = useReferralRewards(); const off = q.error instanceof ApiError && q.error.isFeatureDisabled;
  const items = q.data?.items ?? []; const active = items.filter((r) => r.status === "ACTIVE" || r.status === "HELD"); const past = items.filter((r) => !(r.status === "ACTIVE" || r.status === "HELD"));
  return (
    <Screen testID="rewards" style={{ gap: 12 }}>
      <T muted>{t("referral.rewardsHint")}</T>
      {q.isLoading ? <LoadingState /> : off ? <UnavailableState featureKey={(q.error as ApiError).featureKey} scope={(q.error as ApiError).details?.scope as string | undefined} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !items.length ? <EmptyState icon="star" title={t("referral.noRewardsTitle")} hint={t("referral.noRewardsHint")} /> : (
        <>
          <T variant="h2" accessibilityRole="header">{t("referral.activeRewards")}</T>
          {active.length ? active.map((r) => <Line key={r.id} r={r} />) : <T variant="small" muted>{t("referral.noActive")}</T>}
          {past.length ? <><T variant="h2" accessibilityRole="header">{t("referral.history")}</T>{past.map((r) => <Line key={r.id} r={r} />)}</> : null}
          <T testID="rewards-rule" variant="small" muted>{t("referral.rewardRule")}</T>
          <Card style={{ gap: 4 }}><T weight="semibold">{t("referral.terms")}</T><T variant="small" muted>{t("referral.termsPlaceholder")}</T></Card>
        </>)}
    </Screen>
  );
}
export default function RewardsScreen() { return <RequireAuth><Body /></RequireAuth>; }
