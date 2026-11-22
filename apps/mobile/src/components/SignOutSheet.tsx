import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Sheet, T } from "@/components/ui";
import { useAuth } from "@/auth/AuthProvider";
import { disablePush, pushEnabledLocally } from "@/lib/push";
import { haptic } from "@/lib/haptics";

/** Sign out: removes THIS device's push registration on the server (so no more pushes), clears the session + cached queries, then returns to /sign-in. */
export function useSignOut() {
  const { logout } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  return async () => {
    try { const id = await pushEnabledLocally(); await disablePush(id || null); } catch { /* offline: the server row stays until the token is rotated or revoked */ }
    await logout();
    qc.clear();
    router.replace("/sign-in");
  };
}

export function SignOutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const signOut = useSignOut();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await signOut(); haptic.success(); onClose(); } catch { /* stay on the sheet; the user can retry */ } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t("signOutDlg.title")} testID="signout-sheet">
      <View style={{ gap: 12 }} testID="signout-confirm">
        <T variant="h2">{t("signOutDlg.confirm")}</T>
        <T muted>{t("signOutDlg.body")}</T>
        <Button variant="danger" icon="logout" title={t("signOutDlg.action")} onPress={() => void run()} loading={busy} testID="signout-confirm-btn" />
        <Button variant="secondary" title={t("common.cancel")} onPress={onClose} testID="signout-cancel" />
      </View>
    </Sheet>
  );
}
