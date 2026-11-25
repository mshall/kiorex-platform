import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { RequireAuth } from "@/components/feature";
import { ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Banner, Button, Card, Field, Row, Screen, T } from "@/components/ui";
import { formatDayLong, formatMoney } from "@/lib/format";
import { cleanPartnerCode, newRequestKey, useConvertPoints, useLoyaltyHistory, useLoyaltyMe, useRedeemPartnerCode } from "@/modules/loyalty/api";

/** My tier, my points and the exchange for a voucher (GRW-P4-D). Points are a COUNT, never money: no cash figure, top-up, transfer or withdrawal exists on this screen. One request key per tap makes a retry safe. */
function Body() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const me = useLoyaltyMe(); const hist = useLoyaltyHistory(); const convert = useConvertPoints(); const redeem = useRedeemPartnerCode();
  const key = useRef<string | null>(null); const [code, setCode] = useState("");
  const off = me.error instanceof ApiError && me.error.isFeatureDisabled; const d = me.data;
  const cErr = convert.error instanceof ApiError ? convert.error : null; const rErr = redeem.error instanceof ApiError ? redeem.error : null;
  const tap = () => { key.current ??= newRequestKey(); convert.mutate(key.current, { onSuccess: () => { key.current = null; } }); };
  const valid = cleanPartnerCode(code) !== null;
  return (
    <Screen testID="loyalty" style={{ gap: 12 }}>
      <T muted>{t("loyalty.hint")}</T>
      {me.isLoading ? <LoadingState /> : off ? <UnavailableState featureKey={(me.error as ApiError).featureKey} scope={(me.error as ApiError).details?.scope as string | undefined} /> : !d ? <ErrorState error={me.error} onRetry={() => void me.refetch()} /> : (
        <>
          <Banner testID="loyalty-not-money" tone="ink" body={t("loyalty.notMoney")} />
          <Card testID="loyalty-tier" style={{ gap: 6 }}>
            <T variant="large" accessibilityRole="header">{t("loyalty.tierTitle")}</T>
            <T testID="loyalty-tier-name" variant="large">{t(`loyalty.tier.${d.tier}`)}</T>
            {d.tierSince ? <T muted>{t("loyalty.since", { date: formatDayLong(d.tierSince, lang) })}</T> : null}
            <T testID="loyalty-progress" variant="small">{t("loyalty.progress", { done: d.window.completed, months: d.window.months })}</T>
            {d.next ? <T testID="loyalty-next" variant="small" muted>{t("loyalty.next", { remaining: d.next.remaining, tier: t(`loyalty.tier.${d.next.tier}`) })}</T> : d.tier !== "NONE" ? <T variant="small" muted>{t("loyalty.topTier")}</T> : <T testID="loyalty-no-tiers" variant="small" muted>{t("loyalty.noTiers")}</T>}
          </Card>
          <Card testID="loyalty-points" style={{ gap: 6 }}>
            <T variant="large" accessibilityRole="header">{t("loyalty.pointsTitle")}</T>
            <T testID="loyalty-balance" variant="large" accessibilityLabel={t("loyalty.points", { count: d.points.balance })}>{t("loyalty.points", { count: d.points.balance })}</T>
            {d.points.expiringSoon ? <T testID="loyalty-expiring" variant="small" muted>{t("loyalty.expiring", { points: d.points.expiringSoon.points, date: formatDayLong(d.points.expiringSoon.at, lang) })}</T> : d.points.balance === 0 ? <T variant="small" muted>{t("loyalty.noPoints")}</T> : null}
          </Card>
          <Card testID="loyalty-convert" style={{ gap: 8 }}>
            <T variant="large" accessibilityRole="header">{t("loyalty.convertTitle")}</T>
            {!d.conversion.open ? <T testID="loyalty-convert-closed" muted>{t("loyalty.convertClosed")}</T> : (
              <>
                <T>{t("loyalty.convertText", { points: d.conversion.pointsRequired, value: formatMoney(d.conversion.valueMinor / 100, lang) })}</T>
                <T variant="caption" muted>{t("loyalty.blocksLeft", { count: d.conversion.blocksLeftThisYear })}</T>
                {!d.conversion.canConvert && d.points.balance < d.conversion.pointsRequired ? <T testID="loyalty-not-enough" variant="small" muted>{t("loyalty.notEnough", { points: d.conversion.pointsRequired })}</T> : null}
                <Button testID="loyalty-convert-button" title={convert.isPending ? t("loyalty.converting") : t("loyalty.convert", { points: d.conversion.pointsRequired })} disabled={!d.conversion.canConvert || convert.isPending} loading={convert.isPending} onPress={tap} />
              </>)}
            {cErr ? <Banner testID="loyalty-convert-error" tone="danger" body={t(`loyalty.errors.${cErr.code}`, { defaultValue: t("loyalty.errors.GENERIC") })} /> : null}
            {convert.data ? <Banner testID="loyalty-converted" tone="success" body={t("loyalty.converted", { value: formatMoney(convert.data.amountMinor / 100, lang) })} /> : null}
          </Card>
          <Card testID="loyalty-partner" style={{ gap: 8 }}>
            <T variant="large" accessibilityRole="header">{t("loyalty.partnerTitle")}</T>
            <Field testID="loyalty-partner-code" label={t("loyalty.partnerLabel")} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} autoComplete="off" maxLength={24} placeholder="XXXXX-XXXXX" style={{ writingDirection: "ltr", textAlign: "left" }} />
            <T variant="small" muted>{t("loyalty.partnerHelp")}</T>
            <Button testID="loyalty-partner-submit" title={t("loyalty.partnerButton")} disabled={!valid || redeem.isPending} loading={redeem.isPending} onPress={() => { const c = cleanPartnerCode(code); if (c) redeem.mutate(c, { onSuccess: () => setCode("") }); }} />
            {rErr ? <Banner testID="loyalty-partner-error" tone="danger" body={t(`loyalty.errors.${rErr.code}`, { defaultValue: t("loyalty.errors.GENERIC") })} /> : null}
            {redeem.data ? <Banner testID="loyalty-partner-done" tone="success" body={t("loyalty.partnerDone", { value: formatMoney(redeem.data.amountMinor / 100, lang), partner: lang.startsWith("ar") ? redeem.data.partner.ar : redeem.data.partner.en })} /> : null}
            <T testID="loyalty-partner-terms" variant="small" muted>{t("loyalty.partnerTerms")}</T>
          </Card>
          <Card testID="loyalty-history" style={{ gap: 6 }}>
            <T variant="large" accessibilityRole="header">{t("loyalty.historyTitle")}</T>
            {!hist.data?.items.length ? <T muted>{t("loyalty.historyEmpty")}</T> : hist.data.items.map((e) => (
              <Row key={e.id} gap={8} style={{ justifyContent: "space-between" }}><T variant="small">{t(`loyalty.type.${e.type}`)} · {formatDayLong(e.at, lang)}</T><T variant="small" weight="semibold">{e.direction === "IN" ? "+" : "-"}{e.points}</T></Row>))}
          </Card>
        </>)}
    </Screen>
  );
}
export default function LoyaltyScreen() { return <RequireAuth><Body /></RequireAuth>; }
