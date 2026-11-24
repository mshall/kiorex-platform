import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { TabFrame } from "@/components/BrandHeader";
import { ApiError } from "@/api/errors";
import { usePrescriptions, useUploadRecord, useVault } from "@/api/features";
import { useAuth } from "@/auth/AuthProvider";
import { RequireAuth } from "@/components/feature";
import { RecordCard, type VaultKind } from "@/components/RecordCard";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "@/components/states";
import { Banner, Button, Chip, Field, Row, Screen, Sheet, T } from "@/components/ui";
import { useFeature } from "@/hooks/useFeature";
import { track } from "@/lib/analytics";
import { pickDocument, pickPhoto, type PickedFile } from "@/lib/files";
import { space } from "@/theme";

const FILTERS: (VaultKind | "ALL")[] = ["ALL", "PRESCRIPTION", "LAB_RESULT", "VISIT_SUMMARY", "UPLOAD"];

function Vault() {
  const { t } = useTranslation();
  const router = useRouter();
  const [filter, setFilter] = useState<VaultKind | "ALL">("ALL");
  const vaultFlag = useFeature("kiorex.record_vault");
  const vault = useVault(filter === "ALL" || filter === "PRESCRIPTION" ? undefined : filter);
  const rx = usePrescriptions(filter === "PRESCRIPTION");
  const upload = useUploadRecord();
  const [sheet, setSheet] = useState(false);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  useEffect(() => { track("vault_opened"); }, []);

  const q = filter === "PRESCRIPTION" ? rx : vault;
  const items = filter === "PRESCRIPTION" ? rx.data : vault.data?.items;
  // readOnly: kiorex.record_vault is OFF — records stay readable/deletable, no new uploads or shares.
  const readOnly = !!vault.data?.readOnly || !vaultFlag.enabled;

  const doUpload = async (picker: () => Promise<PickedFile | string | null>) => {
    setMsg(null);
    const f = await picker();
    if (f === null) return;
    if (typeof f === "string") { setMsg({ tone: "danger", text: t(`records.pick.${f}`) }); return; }
    upload.mutate({ fileName: f.fileName, mimeType: f.mimeType, contentBase64: f.contentBase64, title: title.trim() || undefined }, {
      onSuccess: () => { setSheet(false); setTitle(""); setMsg({ tone: "success", text: t("records.uploaded") }); },
      onError: (e) => { setSheet(false); setMsg({ tone: "danger", text: e instanceof ApiError && e.isFeatureDisabled ? t("records.uploadOff") : e instanceof ApiError && e.code === "FILE_TOO_LARGE" ? t("records.pick.size") : t("records.pick.failed") }); },
    });
  };

  return (
    <>
      <Row style={{ justifyContent: "space-between" }}>
        <T variant="large" accessibilityRole="header" style={{ flex: 1 }}>{t("records.title")}</T>
        <Button testID="add-record" small icon="plus" title={t("records.add")} disabled={readOnly} onPress={() => { setMsg(null); setSheet(true); }} />
      </Row>
      {readOnly ? <Banner testID="vault-readonly" tone="warning" title={t("records.readOnlyTitle")} body={t("records.readOnlyBody")} /> : null}
      {msg ? <Banner tone={msg.tone} body={msg.text} testID="records-message" /> : null}
      <Row style={{ flexWrap: "wrap" }}>
        <Button small variant="secondary" icon="shield" testID="nav-sharing" title={t("records.sharing")} onPress={() => router.push("/records/sharing")} />
        <Button small variant="secondary" icon="bell" testID="nav-followups" title={t("records.followUps")} onPress={() => router.push("/records/follow-ups")} />
      </Row>
      <Row style={{ flexWrap: "wrap" }}>{FILTERS.map((f) => <Chip key={f} testID={`filter-${f}`} label={t(`records.filter.${f}`)} selected={filter === f} onPress={() => setFilter(f)} />)}</Row>
      {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !items?.length ? (
        <EmptyState icon="file" title={t("records.empty")} hint={t("records.emptyHint")} />
      ) : items.map((r) => <RecordCard key={r.id} r={r} onOpen={() => router.push(`/records/${r.id}`)} />)}

      <Sheet visible={sheet} onClose={() => setSheet(false)} title={t("records.add")} testID="add-record-sheet">
        <T variant="small" muted>{t("records.addHint")}</T>
        <Field testID="record-title" label={t("records.titleLabel")} value={title} onChangeText={setTitle} maxLength={120} />
        <Button testID="pick-document" icon="file" variant="secondary" loading={upload.isPending} title={t("records.pickDocument")} onPress={() => void doUpload(pickDocument)} />
        <Button testID="pick-photo" icon="image" variant="secondary" loading={upload.isPending} title={t("records.pickPhoto")} onPress={() => void doUpload(pickPhoto)} />
      </Sheet>
    </>
  );
}

export default function RecordsTab() { return <TabFrame><RecordsTabInner /></TabFrame>; }
function RecordsTabInner() {
  const insets = useSafeAreaInsets();
  const { status } = useAuth();
  return (
    <Screen underHeader testID="records" style={{ paddingTop: space[2], gap: 14 }}>
      {status === "signedIn" ? <Vault /> : <RequireAuth><View /></RequireAuth>}
    </Screen>
  );
}
