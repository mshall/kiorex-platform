import { Linking, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useFeature } from "@/hooks/useFeature";
import { Icon } from "@/components/Icon";
import { Badge, Card, Row, T } from "@/components/ui";
import { SERVICE_CARDS, WHATSAPP_FLAG, availability, whatsappUrl, type ServiceCard } from "@/lib/services";
import { track } from "@/lib/analytics";
import { useTheme } from "@/theme";

export function AvailabilityBadge({ flag, testID }: { flag: string; testID?: string }) {
  const { t } = useTranslation();
  const f = useFeature(flag);
  if (f.isLoading) return null;
  const a = availability(f);
  return <Badge testID={testID} tone={a === "available" ? "success" : "warning"} label={t(`services.${a}`)} />;
}

export function ServiceCardView({ card }: { card: ServiceCard }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const f = useFeature(card.flag);
  const a = availability(f);
  const title = t(card.titleKey);
  return (
    <Card testID={`svc-${card.id}`} onPress={() => router.push(card.href as never)} accessibilityLabel={`${title}. ${t(card.bodyKey)}. ${f.isLoading ? "" : t(`services.${a}`)}`} style={{ gap: 8 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" }}><Icon name={card.icon} color={colors.ink} /></View>
        <AvailabilityBadge flag={card.flag} testID={`svc-${card.id}-badge`} />
      </Row>
      <T variant="h2" accessibilityRole="header">{title}</T>
      <T variant="small" muted>{t(card.bodyKey)}</T>
    </Card>
  );
}

/** WhatsApp booking (KXM-BK-11): information only; the conversation runs on WhatsApp. The link shows only when a number is configured. */
export function WhatsAppCard({ number }: { number: string | undefined }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const f = useFeature(WHATSAPP_FLAG);
  const url = whatsappUrl(number);
  return (
    <Card testID="whatsapp-card" style={{ gap: 10 }}>
      <Row style={{ justifyContent: "space-between" }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.soft, alignItems: "center", justifyContent: "center" }}><Icon name="globe" color={colors.ink2} /></View>
        <AvailabilityBadge flag={WHATSAPP_FLAG} testID="whatsapp-badge" />
      </Row>
      <T variant="h2" accessibilityRole="header">{t("services.whatsapp.title")}</T>
      <T muted>{t("services.whatsapp.body")}</T>
      {(["s1", "s2", "s3"] as const).map((k, i) => <Row key={k} gap={10} style={{ alignItems: "flex-start" }}><T weight="semibold" color={colors.ink2}>{`${i + 1}.`}</T><T style={{ flex: 1 }}>{t(`services.whatsapp.${k}`)}</T></Row>)}
      <T variant="caption" muted testID="whatsapp-privacy">{t("services.whatsapp.privacy")}</T>
      {f.enabled ? (url
        ? <Pressable testID="whatsapp-link" accessibilityRole="link" accessibilityLabel={t("services.whatsapp.open")} onPress={() => { track("whatsapp_link_clicked"); void Linking.openURL(url); }} style={{ minHeight: 48, borderRadius: 12, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 }}><T weight="semibold" color={colors.onInk}>{t("services.whatsapp.open")}</T></Pressable>
        : <T weight="medium" testID="whatsapp-soon">{t("services.whatsapp.soon")}</T>) : null}
    </Card>
  );
}

export const ServiceCards = () => <>{SERVICE_CARDS.map((c) => <ServiceCardView key={c.id} card={c} />)}</>;
