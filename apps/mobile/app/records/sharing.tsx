import { useState } from "react";
import { Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/errors";
import { useRecordSharing, useSetRecordSharing } from "@/api/features";
import { RequireAuth } from "@/components/feature";
import { ErrorState, LoadingState } from "@/components/states";
import { Banner, Card, Row, Screen, T } from "@/components/ui";
import { useFeature } from "@/hooks/useFeature";
import { formatDay } from "@/lib/format";
import { useTheme } from "@/theme";

/** Per-scope record-sharing consent (KXM-RC-01). Grant needs kiorex.record_vault AND clinic.record_share_patient_app; revoke is ALWAYS allowed. */
function Body() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const q = useRecordSharing();
  const set = useSetRecordSharing();
  const vault = useFeature("kiorex.record_vault");
  const [msg, setMsg] = useState<string | null>(null);
  const canGrant = !!q.data?.canGrant && vault.enabled;
  return (
    <Screen testID="record-sharing" style={{ gap: 12 }}>
      <T muted>{t("sharing.intro")}</T>
      {q.data && !canGrant ? <Banner testID="sharing-gated" tone="warning" title={t("sharing.gatedTitle")} body={t("sharing.gatedBody")} /> : null}
      {msg ? <Banner tone="warning" body={msg} testID="sharing-message" /> : null}
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data?.scopes.map((s) => {
        const disabled = !s.granted && !canGrant; // revoking stays possible
        return (
          <Card key={s.scope} style={{ gap: 4 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <T weight="semibold">{t(`sharing.scope.${s.scope}.title`)}</T>
                <T variant="small" muted>{t(`sharing.scope.${s.scope}.body`)}</T>
                {s.updatedAt ? <T variant="caption" muted>{t("consent.updated", { date: formatDay(s.updatedAt, i18n.language) })}</T> : null}
              </View>
              <Switch testID={`share-${s.scope}`} accessibilityLabel={t(`sharing.scope.${s.scope}.title`)} value={s.granted} disabled={disabled || set.isPending}
                onValueChange={(granted) => { setMsg(null); set.mutate({ scope: s.scope, granted }, { onError: (e) => setMsg(e instanceof ApiError && e.isFeatureDisabled ? t("sharing.gatedBody") : t("states.errorBody")) }); }}
                trackColor={{ true: colors.ink, false: colors.border }} />
            </Row>
          </Card>
        );
      })}
      <T variant="caption" muted>{t("sharing.revokeNote")}</T>
    </Screen>
  );
}
export default function RecordSharing() { return <RequireAuth><Body /></RequireAuth>; }
