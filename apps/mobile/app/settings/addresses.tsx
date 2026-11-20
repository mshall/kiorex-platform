import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { useAddresses, useDeleteAddress } from "@/api/homecare";
import type { Address } from "@/api/types";
import { AddressSheet, ConfirmAddressButton } from "@/components/homecare";
import { RequireAuth } from "@/components/feature";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { Badge, Banner, Button, Card, Row, Screen, Sheet, T } from "@/components/ui";
import { maskedAddressLine } from "@/lib/homecare";

function Body() {
  const { t, i18n } = useTranslation();
  const q = useAddresses();
  const del = useDeleteAddress();
  const [edit, setEdit] = useState<Address | undefined>();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<Address | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const openSheet = (a?: Address) => { setEdit(a); setOpen(true); };
  return (
    <>
      <Screen testID="addresses" style={{ gap: 12 }}>
        <T variant="small" muted>{t("address.privacy")}</T>
        {msg ? <Banner tone="ink" body={msg} testID="address-message" /> : null}
        {q.isLoading ? <LoadingState /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length ? (
          <EmptyState icon="pin" title={t("address.empty")} hint={t("address.emptyHint")} />
        ) : q.data.map((a) => (
          <Card key={a.id} testID={`address-${a.id}`} style={{ gap: 8 }}>
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, gap: 4 }}>
                <T weight="semibold" testID={`address-line-${a.id}`}>{maskedAddressLine(a, i18n.language)}</T>
                <T variant="small" muted>{a.summary}</T>
              </View>
              {a.isDefault ? <Badge tone="muted" label={t("address.default")} /> : null}
            </Row>
            <Row style={{ flexWrap: "wrap" }}><Badge tone={a.confirmed ? "success" : "warning"} icon={a.confirmed ? "shield" : "alert"} label={a.confirmed ? t("address.confirmed") : t("address.unconfirmed")} /></Row>
            <ConfirmAddressButton address={a} onDone={() => setMsg(t("address.confirmedMsg"))} />
            <Row gap={8} style={{ flexWrap: "wrap" }}>
              <Button testID={`edit-address-${a.id}`} small variant="secondary" icon="file" title={t("address.edit")} onPress={() => openSheet(a)} />
              <Button testID={`delete-address-${a.id}`} small variant="ghost" icon="trash" title={t("common.delete")} onPress={() => setRemoving(a)} />
            </Row>
          </Card>
        ))}
        <Button testID="add-address" icon="plus" title={t("address.add")} onPress={() => openSheet()} />
      </Screen>
      <AddressSheet visible={open} address={edit} onClose={() => setOpen(false)} onSaved={() => setMsg(t("address.saved"))} />
      <Sheet visible={!!removing} onClose={() => setRemoving(null)} title={t("address.deleteTitle")} testID="delete-address-sheet"
        footer={<Row gap={10}><Button style={{ flex: 1 }} variant="secondary" title={t("common.cancel")} onPress={() => setRemoving(null)} />
          <Button testID="confirm-delete-address" style={{ flex: 1 }} variant="danger" loading={del.isPending} title={t("common.delete")} onPress={() => removing && del.mutate(removing.id, { onSettled: () => setRemoving(null), onSuccess: () => setMsg(t("address.deleted")) })} /></Row>}>
        <T>{t("address.deleteBody")}</T>
      </Sheet>
    </>
  );
}
export default function Addresses() { return <RequireAuth><Body /></RequireAuth>; }
