import { useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useDeleteAccount } from "@/api/hooks";
import { useAuth } from "@/auth/AuthProvider";
import { Banner, Button, Card, Checkbox, Field, Screen, T } from "@/components/ui";

/** In-app account deletion with optional export (KXMAC06). Requires typing the confirmation word. */
export default function DeleteAccount() {
  const { t } = useTranslation();
  const router = useRouter();
  const { logout } = useAuth();
  const del = useDeleteAccount();
  const [exportFirst, setExportFirst] = useState(true);
  const [word, setWord] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const word0 = t("account.deleteWord");
  const ok = word.trim().toUpperCase() === word0.toUpperCase();
  const run = () => del.mutate(exportFirst, {
    onSuccess: async (r) => {
      setMsg(r?.export ? `${t("account.deleteRequested")} · ${t("account.exportReady")}` : t("account.deleteRequested"));
      await logout();
      router.replace("/sign-in");
    },
    onError: () => setMsg(t("appointment.actionFailed")),
  });
  return (
    <Screen testID="delete-account" style={{ gap: 14 }}>
      <Card style={{ gap: 10 }}>
        <T variant="h2" accessibilityRole="header">{t("account.deleteConfirmTitle")}</T>
        <T>{t("account.deleteBody")}</T>
        <T variant="small" muted>{t("account.deleteConfirmBody")}</T>
        <Checkbox testID="export-first" checked={exportFirst} onChange={setExportFirst} label={t("account.exportFirst")} />
        <Field testID="delete-word" label={t("account.typeToConfirm", { word: word0 })} value={word} onChangeText={setWord} autoCapitalize="characters" />
        <Button testID="confirm-delete" variant="danger" title={t("account.deleteConfirm")} disabled={!ok} loading={del.isPending} onPress={run} />
      </Card>
      {msg ? <Banner tone="ink" body={msg} /> : null}
    </Screen>
  );
}
