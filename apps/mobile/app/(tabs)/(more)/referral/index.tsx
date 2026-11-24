import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Banner, Card, Row, Screen, T } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { formatMoney, formatNumber } from "@/lib/format";
import { useTheme } from "@/theme";
import { InviteShare } from "@/modules/referral/InviteShare";
import { useCachedMe, useReferralMe } from "@/modules/referral/api";

function Stat({ id, label, value }: { id: string; label: string; value: string }) {
  return <Card testID={id} style={{ flex: 1, minWidth: 96, gap: 2 }}><T variant="large" accessibilityLabel={`${label}: ${value}`}>{value}</T><T variant="caption" muted>{label}</T></Card>;
}

function Body() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const router = useRouter(); const { colors } = useTheme();
  const q = useReferralMe(); const off = q.error instanceof ApiError && q.error.isFeatureDisabled;
  const cached = useCachedMe(!!q.error && !off); const me = q.data ?? (q.error && !off ? cached.data ?? undefined : undefined); const fromCache = !q.data && !!me;
  const n = (v?: number) => formatNumber(v ?? 0, lang, 0);
  return (
    <Screen testID="referral" style={{ gap: 12 }} refresh={undefined}>
      <T muted>{t("referral.hint")}</T>
      {q.isLoading ? <LoadingState /> : off ? <UnavailableState featureKey={(q.error as ApiError).featureKey} scope={(q.error as ApiError).details?.scope as string | undefined} /> : !me ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          {fromCache ? <Banner testID="referral-cached" tone="warning" body={t("referral.cachedOffline")} /> : null}
          <InviteShare me={me} offline={fromCache} />
          <Row gap={8} style={{ flexWrap: "wrap" }} testID="referral-counts"><Stat id="count-invited" label={t("referral.invited")} value={n(me.counts.invited)} /><Stat id="count-joined" label={t("referral.joined")} value={n(me.counts.signedUp)} /><Stat id="count-completed" label={t("referral.completed")} value={n(me.counts.qualified)} /></Row>
          {(me.counts.invited ?? 0) === 0 ? <EmptyState icon="users" title={t("referral.emptyTitle")} hint={t("referral.emptyHint")} /> : null}
          {me.capsRemaining?.thisYear !== undefined ? <T testID="referral-caps" variant="small" muted>{t("referral.capsLeft", { count: me.capsRemaining.thisYear })}</T> : null}
          <Card testID="referral-rewards-link" onPress={() => router.push("/referral/rewards" as never)} accessibilityLabel={t("referral.rewardsTitle")}>
            <Row style={{ justifyContent: "space-between" }}><View style={{ flex: 1 }}><T weight="semibold">{t("referral.rewardsTitle")}</T><T variant="small" muted>{me.rewards?.activeCount ? t("referral.rewardsSummary", { count: me.rewards.activeCount, amount: formatMoney((me.rewards.activeMinor ?? 0) / 100, lang) }) : me.rewards ? t("referral.rewardsNone") : t("referral.rewardsHint")}</T></View><Icon name="chevron" size={18} color={colors.muted} mirror /></Row>
          </Card>
          <Card testID="referral-terms" style={{ gap: 4 }}><T weight="semibold">{t("referral.terms")}</T><T variant="small" muted>{t("referral.termsPlaceholder")}</T></Card>
        </>)}
    </Screen>
  );
}
export default function ReferralScreen() { return <RequireAuth><Body /></RequireAuth>; }
