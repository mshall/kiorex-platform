import { Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useConsents, useSetConsent } from "@/api/hooks";
import type { ConsentPurpose } from "@/api/types";
import { ErrorState, LoadingState } from "@/components/states";
import { Card, Row, Screen, T } from "@/components/ui";
import { formatDay } from "@/lib/format";
import { useTheme } from "@/theme";
import { RequireAuth } from "@/components/feature";

const KEY: Record<ConsentPurpose, string> = { MARKETPLACE_PROCESSING: "marketplace_processing", REMINDERS: "reminders", RECORD_SHARING: "record_sharing", AI_PROCESSING: "ai_processing", VISIT_STATUS_SHARING: "visit_status_sharing" };

function ConsentsBody() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const q = useConsents();
  const set = useSetConsent();
  return (
    <Screen testID="consents" style={{ gap: 12 }}>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data?.filter((c) => c.purpose !== "AI_PROCESSING").map((c) => (
        <Card key={c.purpose} style={{ gap: 4 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}><T weight="semibold">{t(`consent.${KEY[c.purpose]}.title`)}</T><T variant="small" muted>{t(`consent.${KEY[c.purpose]}.body`)}</T>
              {c.updatedAt ? <T variant="caption" muted>{t("consent.updated", { date: formatDay(c.updatedAt, i18n.language) })}</T> : null}</View>
            <Switch testID={`consent-${c.purpose}`} accessibilityLabel={t(`consent.${KEY[c.purpose]}.title`)} value={c.granted} onValueChange={(v) => set.mutate({ purpose: c.purpose, granted: v })} trackColor={{ true: colors.ink, false: colors.border }} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}

export default function Consents() { return <RequireAuth><ConsentsBody /></RequireAuth>; }
