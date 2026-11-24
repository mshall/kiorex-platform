import { useState } from "react";
import { Platform, Share, View } from "react-native";
import { useTranslation } from "react-i18next";
import { QrCode } from "@/components/feature";
import { Banner, Button, Card, Row, T, useToast } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import { useCreateInvite, type ReferralMe } from "./api";

/** Invite code, link, QR, share sheet (system share, which also offers Copy), copy (web) and WhatsApp. A share asks the API for a share event; no contact data is read or sent. */
export function InviteShare({ me, offline }: { me: ReferralMe; offline?: boolean }) {
  const { t, i18n } = useTranslation(); const { colors } = useTheme(); const toast = useToast(); const create = useCreateInvite(); const [copied, setCopied] = useState(false);
  const locale = i18n.language.startsWith("ar") ? "ar" : "en"; const url = me.inviteUrl ?? ""; const disabled = me.status !== "ACTIVE" || !url;
  const message = async (channel: "LINK" | "WHATSAPP_SHARE" | "COPY") => { if (!offline) { try { const r = await create.mutateAsync({ channel, locale }); if (r.shareText) return r.shareText; } catch { /* use the local text */ } } return t("referral.shareText", { url }); };
  const share = async () => { haptic.press(); try { await Share.share({ message: await message("LINK") }); } catch { /* closed */ } };
  const copy = async () => {
    haptic.success();
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) { try { await navigator.clipboard.writeText(url); setCopied(true); toast.show(t("referral.copied")); void message("COPY"); setTimeout(() => setCopied(false), 2500); return; } catch { /* fall through */ } }
    await share(); // native: the share sheet carries the Copy action (no clipboard module is bundled)
  };
  const whatsapp = async () => { haptic.press(); const text = encodeURIComponent(await message("WHATSAPP_SHARE")); const { Linking } = await import("react-native"); try { await Linking.openURL(`https://wa.me/?text=${text}`); } catch { toast.show(t("referral.copyFailed"), "error"); } };
  return (
    <Card testID="invite-card" style={{ gap: 14 }}>
      <View style={{ gap: 4 }}><T variant="h2" accessibilityRole="header">{t("referral.inviteTitle")}</T><T variant="small" muted>{t("referral.inviteHint")}</T></View>
      <View><T variant="small" muted>{t("referral.yourCode")}</T><T testID="invite-code" variant="large" forceLatin style={{ letterSpacing: 6, writingDirection: "ltr", textAlign: i18n.language.startsWith("ar") ? "right" : "left" }} accessibilityLabel={`${t("referral.yourCode")} ${me.code.split("").join(" ")}`}>{me.code}</T></View>
      {url ? <><T variant="small" muted>{t("referral.yourLink")}</T><T testID="invite-link" variant="small" forceLatin selectable style={{ writingDirection: "ltr", textAlign: "left", color: colors.text }}>{url}</T></> : null}
      {me.status !== "ACTIVE" ? <Banner testID="invite-suspended" tone="warning" body={t("referral.suspended")} /> : null}
      <Row gap={8} style={{ flexWrap: "wrap" }}>
        <Button testID="invite-share" small icon="upload" title={t("referral.share")} disabled={disabled} onPress={() => void share()} />
        <Button testID="invite-copy" small variant="secondary" title={copied ? t("referral.copiedShort") : t("referral.copy")} disabled={disabled} onPress={() => void copy()} />
        <Button testID="invite-whatsapp" small variant="secondary" icon="phone" title={t("referral.whatsapp")} disabled={disabled} onPress={() => void whatsapp()} />
      </Row>
      {url ? <View style={{ alignItems: "center", gap: 6 }}><QrCode value={url} size={168} /><T variant="caption" muted style={{ textAlign: "center" }}>{t("referral.qrHint")}</T></View> : null}
    </Card>
  );
}
