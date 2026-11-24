import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { RequireAuth } from "@/components/feature";
import { ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Banner, Button, Card, Field, Row, Screen, T } from "@/components/ui";
import { formatDayLong, formatMoney } from "@/lib/format";
import { cleanCorporateCode, useCorporateMe, useJoinCorporate, useLeaveCorporate } from "@/modules/corporate/api";

const KNOWN = ["CORPORATE_CODE_INVALID", "CORPORATE_CODE_EXPIRED", "CORPORATE_CODE_EXHAUSTED", "CORPORATE_NOT_ELIGIBLE", "CORPORATE_ALREADY_MEMBER", "CORPORATE_ACCOUNT_NOT_ACTIVE", "CORPORATE_EMAIL_NOT_VERIFIED"];

/** The company benefit screen (GRW-P4-C): join with a code or a verified work e-mail, see MY allowance as a usage figure (never a cash balance), leave at any time. */
function Body() {
  const { t, i18n } = useTranslation(); const lang = i18n.language; const q = useCorporateMe(); const join = useJoinCorporate(); const leave = useLeaveCorporate();
  const [code, setCode] = useState(""); const [confirm, setConfirm] = useState(false);
  const off = q.error instanceof ApiError && q.error.isFeatureDisabled; const err = join.error instanceof ApiError ? join.error : null; const valid = cleanCorporateCode(code) !== null;
  return (
    <Screen testID="corporate" style={{ gap: 12 }}>
      <T muted>{t("corporate.hint")}</T>
      {q.isLoading ? <LoadingState /> : off ? <UnavailableState featureKey={(q.error as ApiError).featureKey} scope={(q.error as ApiError).details?.scope as string | undefined} /> : !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data.member ? (
        <Card testID="corporate-member" style={{ gap: 10 }}>
          <T variant="large" accessibilityRole="header">{t("corporate.memberTitle", { sponsor: q.data.programme.sponsor })}</T>
          {q.data.programme.endsAt ? <T muted>{t("corporate.until", { date: formatDayLong(q.data.programme.endsAt, lang) })}</T> : null}
          <Row gap={8} style={{ flexWrap: "wrap" }} testID="corporate-allowance">
            {(["allowanceCap", "allowanceUsed", "allowanceLeft"] as const).map((k) => { const a = q.data.member ? q.data.allowance : null; const v = !a ? 0 : k === "allowanceCap" ? a.capMinor : k === "allowanceUsed" ? a.usedMinor + a.heldMinor : a.remainingMinor; const text = formatMoney(v / 100, lang);
              return <Card key={k} style={{ flex: 1, minWidth: 96, gap: 2 }}><T variant="large" accessibilityLabel={`${t(`corporate.${k}`)}: ${text}`}>{text}</T><T variant="caption" muted>{t(`corporate.${k}`)}</T></Card>; })}
          </Row>
          <T testID="corporate-how" variant="small" muted>{t("corporate.how")}</T>
          <Banner testID="corporate-privacy" tone="ink" body={t("corporate.privacy")} />
          {!confirm ? <Button testID="corporate-leave" variant="secondary" title={t("corporate.leave")} onPress={() => setConfirm(true)} /> : (
            <Card testID="corporate-leave-confirm" style={{ gap: 8 }}><T weight="semibold">{t("corporate.leaveConfirm")}</T><T variant="small" muted>{t("corporate.leaveHint")}</T>
              <Row gap={8}><Button testID="corporate-leave-yes" title={t("corporate.leaveYes")} loading={leave.isPending} onPress={() => leave.mutate(undefined, { onSuccess: () => setConfirm(false) })} /><Button variant="secondary" title={t("corporate.cancel")} onPress={() => setConfirm(false)} /></Row></Card>)}
        </Card>
      ) : (
        <Card testID="corporate-join" style={{ gap: 10 }}>
          <T variant="large" accessibilityRole="header">{t("corporate.joinTitle")}</T>
          <Field testID="corporate-code" label={t("corporate.codeLabel")} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} autoComplete="off" maxLength={24} placeholder="XXXXX-XXXXX" style={{ writingDirection: "ltr", textAlign: "left", fontVariant: ["tabular-nums"] }} />
          <T variant="small" muted>{t("corporate.codeHelp")}</T>
          <Button testID="corporate-submit" title={t("corporate.join")} disabled={!valid || join.isPending} loading={join.isPending} onPress={() => { const c = cleanCorporateCode(code); if (c) join.mutate(c); }} />
          <T variant="small" muted>{t("corporate.orEmail")}</T>
          <Button testID="corporate-email" variant="secondary" title={t("corporate.useEmail")} disabled={join.isPending} onPress={() => join.mutate(undefined)} />
          {err ? <Banner testID="corporate-error" tone="danger" body={KNOWN.includes(err.code) ? t(`corporate.errors.${err.code}`) : t("corporate.errors.GENERIC")} /> : null}
          <T testID="corporate-terms" variant="small" muted>{t("corporate.terms")}</T>
        </Card>)}
    </Screen>
  );
}
export default function CorporateScreen() { return <RequireAuth><Body /></RequireAuth>; }
