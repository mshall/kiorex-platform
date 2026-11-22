import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAddFollowUp, useDeleteRecord, useVaultItem } from "@/api/features";
import type { S } from "@/api/types";
import { QrCode, RequireAuth } from "@/components/feature";
import { ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Chip, Row, Screen, Sheet, T } from "@/components/ui";
import { flatten } from "@/lib/records";
import { fetchImageDataUri, openVaultFile } from "@/lib/files";
import { formatDay, formatDayLong } from "@/lib/format";
import { useTheme } from "@/theme";
import { KIND_ICON } from "@/components/RecordCard";
import { Icon } from "@/components/Icon";

function Body({ r }: { r: S["VaultDetailDto"] }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const del = useDeleteRecord();
  const follow = useAddFollowUp();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsgText] = useState<{ ok: boolean; text: string } | null>(null);
  const setMsg = (text: string | null, ok = false) => setMsgText(text ? { ok, text } : null);
  const [img, setImg] = useState<string | null>(null);
  const isImage = !!r.mimeType?.startsWith("image/");
  useEffect(() => { if (r.hasFile && isImage) void fetchImageDataUri(r.id).then(setImg); }, [r.id, r.hasFile, isImage]);
  const title = r.title || r.fileName || t(`records.kind.${r.kind}`);
  const rxItems = (r.prescription as { items?: { name?: string; dose?: string; instructions?: string }[] | null } | undefined)?.items;
  const content = r.kind === "VISIT_SUMMARY" ? flatten(r.content) : r.kind === "LAB_RESULT" ? flatten(r.report) : [];
  const verify = r.verification;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen testID="record-detail" style={{ gap: 14 }}>
        <Card style={{ gap: 8 }}>
          <Row gap={10}><View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" }}><Icon name={KIND_ICON[r.kind]} color={colors.ink} /></View>
            <View style={{ flex: 1 }}><T variant="h2" accessibilityRole="header">{title}</T><T variant="small" muted>{t(`records.kind.${r.kind}`)}</T></View></Row>
          <Row style={{ flexWrap: "wrap" }}><Badge tone="ocean" label={t(`records.source.${r.source}`)} />{r.signedAt ? <Badge tone="success" icon="check" label={t("records.signedOn", { date: formatDay(r.signedAt, i18n.language) })} /> : null}</Row>
          <T variant="caption" muted>{t("records.addedOn", { date: formatDayLong(r.createdAt, i18n.language) })}</T>
        </Card>

        {msg ? <Banner tone={msg.ok ? "success" : "warning"} body={msg.text} testID="record-message" /> : null}

        {r.kind === "PRESCRIPTION" ? (
          <Card testID="rx-card" style={{ gap: 12 }}>
            <T variant="h2">{t("records.rxTitle")}</T>
            {rxItems?.length ? rxItems.map((it, i) => <View key={i}><T weight="semibold">{it.name}</T><T variant="small" muted>{[it.dose, it.instructions].filter(Boolean).join(" · ")}</T></View>) : <T variant="small" muted testID="rx-items-pending">{t("records.rxItemsPending")}</T>}
            {verify ? (
              <View style={{ gap: 8 }}>
                <QrCode value={verify.qrPayload} />
                <T variant="small" muted style={{ textAlign: "center" }}>{t("records.qrHint")}</T>
                <T variant="caption" muted forceLatin style={{ textAlign: "center", writingDirection: "ltr" }} selectable testID="rx-token">{verify.token}</T>
              </View>
            ) : null}
          </Card>
        ) : null}

        {content.length ? (
          <Card testID="record-content" style={{ gap: 8 }}>
            {content.map(([k, v]) => <View key={k}><T variant="label" muted>{k}</T><T>{v}</T></View>)}
          </Card>
        ) : null}

        {r.hasFile ? (
          <Card style={{ gap: 10 }}>
            {isImage ? (img ? <Image accessibilityLabel={title} source={{ uri: img }} resizeMode="contain" style={{ width: "100%", height: 260, borderRadius: 10 }} /> : <LoadingState />) : null}
            <T variant="small" muted>{r.fileName} {r.sizeBytes ? `· ${Math.max(1, Math.round(r.sizeBytes / 1024))} KB` : ""}</T>
            <Button testID="open-file" icon="file" variant="secondary" title={t("records.openFile")} onPress={() => void openVaultFile(r.id, r.fileName).then((o) => setMsg(o === "failed" ? t("records.openFailed") : null))} />
          </Card>
        ) : null}

        <Card style={{ gap: 8 }}>
          <T variant="h2">{t("records.remindTitle")}</T>
          <T variant="small" muted>{t("records.remindHint")}</T>
          <Row style={{ flexWrap: "wrap" }}>{[7, 14, 30].map((d) => <Chip key={d} testID={`remind-${d}`} icon="bell" label={t("records.afterDays", { count: d })} onPress={() => follow.mutate({ afterDays: d, recordId: r.id }, { onSuccess: () => setMsg(t("records.reminderSet", { count: d }), true), onError: () => setMsg(t("records.reminderFailed")) })} />)}</Row>
        </Card>

        <Button testID="delete-record" variant="danger" icon="trash" title={t("records.delete")} onPress={() => setConfirm(true)} />
      </Screen>
      <Sheet visible={confirm} onClose={() => setConfirm(false)} title={t("records.deleteTitle")} testID="delete-record-sheet"
        footer={<Row gap={10}><Button style={{ flex: 1 }} variant="secondary" title={t("appointment.keep")} onPress={() => setConfirm(false)} /><Button testID="confirm-delete-record" style={{ flex: 1 }} variant="danger" loading={del.isPending} title={t("records.deleteConfirm")} onPress={() => del.mutate(r.id, { onSuccess: () => { setConfirm(false); router.back(); }, onError: () => { setConfirm(false); setMsg(t("records.deleteFailed")); } })} /></Row>}>
        <T>{r.source === "PATIENT" ? t("records.deleteBodyOwn") : t("records.deleteBodyShared")}</T>
      </Sheet>
    </>
  );
}

export default function RecordDetail() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const q = useVaultItem(id);
  return <RequireAuth>{q.isLoading ? <LoadingState /> : q.error || !q.data ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <Body r={q.data} />}</RequireAuth>;
}
