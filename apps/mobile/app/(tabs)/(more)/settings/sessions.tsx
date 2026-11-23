import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRevokeSession, useSessions } from "@/api/hooks";
import { ErrorState, LoadingState } from "@/components/states";
import { Badge, Button, Card, Row, Screen, T } from "@/components/ui";
import { formatDay, formatTime } from "@/lib/format";
import { RequireAuth } from "@/components/feature";

function SessionsBody() {
  const { t, i18n } = useTranslation();
  const q = useSessions();
  const revoke = useRevokeSession();
  return (
    <Screen testID="sessions" style={{ gap: 12 }}>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data?.map((s) => (
        <Card key={s.id} style={{ gap: 6 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}><T weight="semibold">{s.device ?? "—"}</T><T variant="small" muted>{formatDay(s.lastSeenAt, i18n.language)} · {formatTime(s.lastSeenAt, i18n.language)}</T></View>
            {s.current ? <Badge tone="success" label={t("sessions.current")} /> : <Button small variant="secondary" title={t("sessions.signOut")} onPress={() => revoke.mutate(s.id)} />}
          </Row>
        </Card>
      ))}
    </Screen>
  );
}

export default function Sessions() { return <RequireAuth><SessionsBody /></RequireAuth>; }
